package postgres

import (
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
)

// Exercise the production binaries against a disposable database. An approval checkpoint
// keeps the run active across crashes without relying on container timing.
func TestPipelineProcessRecovery(t *testing.T) {
	s, h, _, _, dsn := integrationFixture(t)
	ctx := t.Context()
	bin := t.TempDir()
	build := exec.CommandContext(ctx, "go", "build", "-o", bin, "./cmd/server", "./cmd/pipeline-worker")
	build.Dir = "../../.."
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v %s", err, out)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	lockMust(t, err)
	addr := listener.Addr().String()
	lockMust(t, listener.Close())
	_, port, err := net.SplitHostPort(addr)
	lockMust(t, err)
	def := pipeline.Definition{APIVersion: pipeline.APIVersion, Name: "recovery", Stages: []pipeline.Stage{{ID: "stage", Jobs: []pipeline.Job{{ID: "job", Steps: []pipeline.Step{{ID: "approve", Uses: pipeline.Approval}}}}}}}
	for i, action := range []string{"create", "publish"} {
		_, err = s.ChangePipeline(ctx, h.organizationID, "recovery", h.userID, action, i, &def)
		lockMust(t, err)
	}
	start := func(name string) func() {
		t.Helper()
		cmd := exec.Command(filepath.Join(bin, name))
		cmd.Env = append(os.Environ(), "DATABASE_URL="+dsn, "APP_ORIGIN=http://"+addr, "PORT="+port, "PIPELINE_CHECK_IMAGE=unused@sha256:"+strings.Repeat("0", 64))
		lockMust(t, cmd.Start())
		stop := func() {
			if cmd.ProcessState == nil {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
			}
		}
		t.Cleanup(stop)
		return stop
	}
	until := func(label string, ok func() bool) {
		t.Helper()
		end := time.Now().Add(20 * time.Second)
		for time.Now().Before(end) {
			if ok() {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("did not observe " + label)
	}
	health := func() bool {
		client := http.Client{Timeout: time.Second}
		resp, err := client.Get("http://" + addr + "/healthz")
		if err != nil {
			return false
		}
		resp.Body.Close()
		return resp.StatusCode == 200
	}
	api := start("server")
	until("API startup", health)
	t.Setenv("PIPELINE_RUNNER_TOKEN", registerTestRunner(t, s, h.organizationID, pipeline.Approval))
	worker := start("pipeline-worker")
	first, err := s.CreateRun(ctx, h.organizationID, "recovery", 1, h.userID, nil)
	lockMust(t, err)
	step := func(id string) (string, int) {
		var status string
		var attempt int
		lockMust(t, s.pool.QueryRow(ctx, `SELECT status,attempt FROM pipeline_step_runs WHERE run_id=$1`, id).Scan(&status, &attempt))
		return status, attempt
	}
	until("waiting approval", func() bool { status, _ := step(first.ID); return status == "waiting" })
	worker()
	queued, err := s.CreateRun(ctx, h.organizationID, "recovery", 1, h.userID, nil)
	lockMust(t, err)
	api()
	start("server")
	until("API restart", health)
	start("pipeline-worker")
	until("queued run resumed", func() bool { status, _ := step(queued.ID); return status == "waiting" })
	status, attempt := step(first.ID)
	if status != "waiting" || attempt != 1 {
		t.Fatalf("replayed approval after restart: %s attempt %d", status, attempt)
	}
	lockMust(t, s.DecideRun(ctx, h.organizationID, first.ID, "approve", h.userID, "succeeded"))
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_runs SET deadline=clock_timestamp() WHERE id=$1`, queued.ID)
	lockMust(t, err)
	until("persisted timeout", func() bool {
		r, err := s.GetRun(ctx, h.organizationID, queued.ID)
		lockMust(t, err)
		status, _ := step(queued.ID)
		return r.Status == "timed_out" && status == "timed_out"
	})
	r, err := s.GetRun(ctx, h.organizationID, first.ID)
	lockMust(t, err)
	if r.Status != "succeeded" {
		t.Fatal("lost approval after restart", r.Status)
	}
}
