package postgres

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestIntegrationBuildAndGatedPromotion(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	s, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	defer s.Close()
	fx := &lockFixture{ctx: ctx, store: s}
	h := newLockHTTP(t, fx, 0, "team/repo")
	root := t.TempDir()
	src := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", src, "-c", "user.name=Test", "-c", "user.email=test@example.invalid"}, args...)...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	git("init", "-b", "main")
	git("commit", "--allow-empty", "-m", "base")
	git("checkout", "-b", "topic")
	git("commit", "--allow-empty", "-m", "reviewed revision")
	revision := git("rev-parse", "HEAD")
	git("commit", "--allow-empty", "-m", "descendant")
	git("clone", "--bare", src, filepath.Join(root, h.organizationID, "team", "repo"))
	provider, err := delivery.NewLocalGitProvider(root, time.Minute)
	lockMust(t, err)
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{Repository: s, Identity: s, CSRF: s, AllowedOrigin: lockHTTPOrigin, Runs: s, Catalog: s, Git: provider})
	def := pipeline.Definition{APIVersion: pipeline.APIVersion, Name: "build", Stages: []pipeline.Stage{{ID: "ci", Jobs: []pipeline.Job{{ID: "job", Steps: []pipeline.Step{{ID: "test", Uses: pipeline.ContainerCheck}}}}}}}
	for i, action := range []string{"create", "publish"} {
		_, err = s.ChangePipeline(ctx, h.organizationID, "p", h.userID, action, i, &def)
		lockMust(t, err)
	}
	base := "/api/v1/organizations/" + h.organizationID
	resp := h.do(ctx, "POST", base+"/pipelines/p/versions/1/integration-runs", `{"repository":"team/repo","target":"main","sources":["topic"]}`)
	if resp.Code != 201 {
		t.Fatalf("build: %d %s", resp.Code, resp.Body)
	}
	var run execution.Run
	lockMust(t, json.Unmarshal(resp.Body.Bytes(), &run))
	if run.Integration == nil {
		t.Fatal("missing candidate")
	}
	promote := func(sha string, want int) {
		t.Helper()
		resp := h.do(ctx, "POST", base+"/pipeline-runs/"+run.ID+"/promote", `{"candidateSHA":"`+sha+`"}`)
		if resp.Code != want {
			t.Fatalf("promote: %d %s, want %d", resp.Code, resp.Body, want)
		}
	}
	sha := run.Integration.CandidateSHA
	promote(sha, 409)
	task, err := s.ClaimTask(ctx, "worker")
	lockMust(t, err)
	if task == nil || task.Integration == nil || task.Integration.CandidateSHA != sha {
		t.Fatal("worker received wrong candidate")
	}
	lockMust(t, s.FinishTask(ctx, *task, "succeeded", "tested"))
	promote(run.Integration.Target.SHA, 409)
	now := time.Now()
	c, err := delivery.NewChangeset("c", "team/repo", "review", h.userID, now)
	lockMust(t, err)
	lockMust(t, c.AddGitRevision("rev", "topic", revision, "", h.userID, now))
	stored, err := s.Create(ctx, h.organizationID, c)
	lockMust(t, err)
	promote(sha, 409)
	lockMust(t, c.RecordEvaluationAgainstBase("eval", "rev", run.Integration.Target.SHA, delivery.EvaluationPassed, "passed", h.userID, now))
	lockMust(t, c.AttachEvidence("evidence", "rev", "eval", "test", "ref", h.userID, now))
	lockMust(t, c.AssignReview("review", "rev", "reviewer", h.userID, "", now))
	lockMust(t, c.DecideReview("review", true, "reviewer", "ok", now))
	_, err = s.Update(ctx, h.organizationID, c, stored.Version)
	lockMust(t, err)
	promote(sha, 200)
	promote(sha, 200)
	stored, err = s.Get(ctx, h.organizationID, c.ID)
	lockMust(t, err)
	if stored.Changeset.Merge == nil || stored.Changeset.Merge.CommitSHA != sha {
		t.Fatal("changeset did not record candidate")
	}
}
