package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPipelineLifecycle(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	s, err := Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	org := fmt.Sprintf("pipeline-%d", time.Now().UnixNano())
	actor := org + "-actor"
	other := org + "-other"
	if _, err = s.pool.Exec(ctx, `INSERT INTO organizations(id,name) VALUES($1,$1),($2,$2)`, org, other); err != nil {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(ctx, `INSERT INTO users(id,display_name) VALUES($1,$1)`, actor); err != nil {
		t.Fatal(err)
	}
	def := pipeline.Definition{APIVersion: pipeline.APIVersion, Name: "release", Stages: []pipeline.Stage{{ID: "review", Jobs: []pipeline.Job{{ID: "gate", Steps: []pipeline.Step{{ID: "sign", Uses: pipeline.Approval}}}}}}}
	raw, _ := json.Marshal(def)
	change := func(action string, rev int) error {
		_, err := s.ChangePipeline(ctx, org, "p", actor, action, rev, &def)
		return err
	}
	if err = change("create", 0); err != nil {
		t.Fatal(err)
	}
	if list, err := s.ListPipelines(ctx, other); err != nil || len(list) != 0 {
		t.Fatalf("other list: %v %v", list, err)
	}
	if _, err = s.GetPipeline(ctx, other, "p"); err != pipeline.ErrMissing {
		t.Fatal(err)
	}
	if _, err = s.ChangePipeline(ctx, other, "p", actor, "publish", 1, nil); err != pipeline.ErrMissing {
		t.Fatal(err)
	}
	result := make(chan error, 2)
	for range 2 {
		go func() { result <- change("publish", 1) }()
	}
	a, b := <-result, <-result
	if !(a == nil && b == pipeline.ErrConflict || b == nil && a == pipeline.ErrConflict) {
		t.Fatalf("publish race: %v %v", a, b)
	}
	def.Name = "next"
	if err = change("save", 1); err != pipeline.ErrConflict {
		t.Fatal(err)
	}
	if err = change("save", 2); err != nil {
		t.Fatal(err)
	}
	if err = change("publish", 3); err != nil {
		t.Fatal(err)
	}
	if err = change("archive", 4); err != nil {
		t.Fatal(err)
	}
	if err = change("save", 5); err != pipeline.ErrConflict {
		t.Fatal(err)
	}
	versions, err := s.PipelineVersions(ctx, org, "p")
	if err != nil || len(versions) != 2 || versions[1].Number != 1 || versions[1].Definition.Name != "release" || versions[1].Checksum != fmt.Sprintf("%x", sha256.Sum256(raw)) {
		t.Fatalf("history: %#v %v", versions, err)
	}
	if _, err = s.PipelineVersions(ctx, other, "p"); err != pipeline.ErrMissing {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE pipeline_versions SET checksum='changed' WHERE organization_id=$1`, org); err == nil {
		t.Fatal("updated published version")
	}
	var n int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM pipeline_audit WHERE organization_id=$1 AND actor_id=$2`, org, actor).Scan(&n); err != nil || n != 5 {
		t.Fatalf("audit count %d: %v", n, err)
	}
}

// Exercise the same session, CSRF middleware and scoped queries used by the browser.
func TestPipelineAPIValidatesPublishedInputs(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{})
	h := newLockHTTP(t, fx, 0)
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{Identity: fx.store, CSRF: fx.store, Pipelines: fx.store, AllowedOrigin: lockHTTPOrigin})
	base := "/api/v1/organizations/" + h.organizationID + "/pipelines"
	call := func(method, path, body string, status int) []byte {
		t.Helper()
		response := h.do(fx.ctx, method, path, body)
		if response.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body.String())
		}
		return response.Body.Bytes()
	}
	const definition = `{"apiVersion":"agentforge.dev/v1","name":"release","stages":[{"id":"review","jobs":[{"id":"gate","steps":[{"id":"sign","uses":"control/approval@v1"}]}]}],"parameters":[{"name":"enabled","type":"boolean","override":true,"required":true}]}`
	call("POST", base, strings.Replace(definition, "apiVersion", "apiversion", 1), 400)
	var created pipeline.Pipeline
	if err := json.Unmarshal(call("POST", base, definition, 201), &created); err != nil {
		t.Fatal(err)
	}
	item := base + "/" + created.ID
	preflight := item + "/versions/1/validate-inputs"
	call("POST", preflight, "{}", 404)
	call("POST", item+"/publish", `{"revision":1}`, 200)
	call("POST", preflight, `{"enabled":false}`, 204)
	call("POST", preflight, `{}`, 400)
	call("PUT", item+"/draft", `{"revision":2,"definition":`+strings.Replace(definition, `"boolean"`, `"string"`, 1)+`}`, 200)
	call("POST", preflight, `{"enabled":"value"}`, 400)
	call("POST", preflight, `{"enabled":true}`, 204)
}

func TestRunCreationUsesPublishedVersion(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{})
	h := newLockHTTP(t, fx, 0)
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{Identity: fx.store, CSRF: fx.store, Runs: fx.store, AllowedOrigin: lockHTTPOrigin})
	base := "/api/v1/organizations/" + h.organizationID
	path := base + "/pipelines/build/versions/1/runs"
	call := func(method, path, body string, want int) []byte {
		t.Helper()
		r := h.do(fx.ctx, method, path, body)
		if r.Code != want {
			t.Fatalf("%s %s: got %d %s want %d", method, path, r.Code, r.Body.String(), want)
		}
		return r.Body.Bytes()
	}
	def := pipeline.Definition{APIVersion: pipeline.APIVersion, Name: "build", Parameters: []pipeline.Parameter{{Name: "color", Type: "choice", Choices: []string{"green", "blue"}, Default: json.RawMessage(`"green"`), Override: true}}, Stages: []pipeline.Stage{{ID: "stage", Jobs: []pipeline.Job{{ID: "job", Steps: []pipeline.Step{{ID: "confirm", Uses: pipeline.Approval}}}}}}}
	change := func(action string, revision int) {
		t.Helper()
		if _, err := fx.store.ChangePipeline(fx.ctx, h.organizationID, "build", h.userID, action, revision, &def); err != nil {
			t.Fatal(err)
		}
	}
	change("create", 0)
	call("POST", path, "{}", 404)
	change("publish", 1)
	def.Parameters[0].Default = json.RawMessage(`"blue"`)
	change("save", 2)
	call("POST", path, `{"color":"red"}`, 400)
	var run execution.Run
	if err := json.Unmarshal(call("POST", path, "{}", 201), &run); err != nil {
		t.Fatal(err)
	}
	if run.Version != 1 || run.Status != "queued" || string(run.Inputs["color"]) != `"green"` {
		t.Fatalf("unexpected snapshot: %+v", run)
	}
	var snapshot execution.Run
	if err := json.Unmarshal(call("GET", base+"/pipeline-runs/"+run.ID, "", 200), &snapshot); err != nil || snapshot.StepStatuses["confirm"] != "queued" {
		t.Fatalf("step snapshot: %v, %v", snapshot.StepStatuses, err)
	}
	if _, err := fx.store.GetRun(fx.ctx, "other", run.ID); err != pipeline.ErrMissing {
		t.Fatalf("foreign run: %v", err)
	}
	var tasks, events int
	if err := fx.store.pool.QueryRow(fx.ctx, `SELECT (SELECT count(*) FROM pipeline_step_runs WHERE run_id=$1),(SELECT count(*) FROM pipeline_run_events WHERE run_id=$1)`, run.ID).Scan(&tasks, &events); err != nil || tasks != 1 || events != 1 {
		t.Fatalf("queued %d tasks and %d events: %v", tasks, events, err)
	}
	change("archive", 3)
	call("POST", path, "{}", 409)
}

func TestWorkerLeaseAndApprovalOrdering(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	dsn = slugScratchDatabase(t, dsn, 1)
	ctx := t.Context()
	s, err := Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	slugInsertOrganization(t, ctx, s, "org", "org", "active")
	slugInsertUser(t, ctx, s, "owner")
	stages := []pipeline.Stage{}
	for _, id := range []string{"a", "b"} {
		stages = append(stages, pipeline.Stage{ID: id, Jobs: []pipeline.Job{{ID: "job" + id, Steps: []pipeline.Step{{ID: "gate" + id, Uses: pipeline.Approval}}}}})
	}
	def := pipeline.Definition{APIVersion: pipeline.APIVersion, Name: "build", Stages: stages}
	for rev, action := range []string{"create", "publish"} {
		if _, err = s.ChangePipeline(ctx, "org", "p", "owner", action, rev, &def); err != nil {
			t.Fatal(err)
		}
	}
	run, err := s.CreateRun(ctx, "org", "p", 1, "owner", nil)
	if err != nil {
		t.Fatal(err)
	}
	runnerTokens := map[string]string{}
	claim := func(worker, id string) *execution.Task {
		t.Helper()
		if runnerTokens[worker] == "" {
			runnerTokens[worker] = registerTestRunner(t, s, "org", pipeline.Approval)
		}
		task, e := s.ClaimTask(ctx, runnerTokens[worker])
		if e != nil || (id == "") != (task == nil) || task != nil && task.StepID != id {
			t.Fatalf("claim %s: %+v, %v", id, task, e)
		}
		return task
	}
	first := claim("worker1", "gatea")
	claim("worker2", "")
	if err = s.Heartbeat(ctx, *first); err != nil {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE pipeline_step_runs SET lease_until=now()-interval '1 second' WHERE run_id=$1 AND id='gatea'`, run.ID); err != nil {
		t.Fatal(err)
	}
	retry := claim("worker2", "gatea")
	if retry.Attempt != 2 || s.FinishTask(ctx, *first, "waiting", "") != execution.ErrLease {
		t.Fatal("old attempt was not fenced")
	}
	if err = s.FinishTask(ctx, *retry, "waiting", ""); err != nil {
		t.Fatal(err)
	}
	claim("worker2", "")
	if err = s.DecideRun(ctx, "other", run.ID, "gatea", "owner", "succeeded"); err != pipeline.ErrMissing {
		t.Fatal(err)
	}
	if err = s.DecideRun(ctx, "org", run.ID, "gatea", "owner", "succeeded"); err != nil {
		t.Fatal(err)
	}
	if err = s.DecideRun(ctx, "org", run.ID, "gatea", "owner", "succeeded"); err != pipeline.ErrConflict {
		t.Fatal(err)
	}
	last := claim("worker3", "gateb")
	if err = s.DecideRun(ctx, "org", run.ID, "", "owner", "cancelled"); err != nil {
		t.Fatal(err)
	}
	if s.Heartbeat(ctx, *last) != execution.ErrLease || s.FinishTask(ctx, *last, "waiting", "") != execution.ErrLease {
		t.Fatal("cancelled task accepted worker update")
	}
	claim("worker1", "")
}
