package postgres

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestTriggerRecoveryAndConcurrentAdmission(t *testing.T) {
	ctx := t.Context()
	s, h, _, sha, dsn := integrationFixture(t)
	exec := func(sql string, args ...any) { t.Helper(); _, err := s.pool.Exec(ctx, sql, args...); lockMust(t, err) }
	exec(`INSERT INTO pipeline_trigger_bindings(organization_id,pipeline_id,version,actor_id,repository) VALUES($1,'p',1,$2,'team/repo')`, h.organizationID, h.userID)
	exec(`INSERT INTO pipeline_trigger_bindings(organization_id,pipeline_id,version,actor_id,every_seconds,next_due) VALUES($1,'p',1,$2,3600,now()-interval '3 days')`, h.organizationID, h.userID)
	c := &delivery.Changeset{ID: "change", Title: "test", Repository: "team/repo", Revisions: []delivery.Revision{{ID: "r1", CommitSHA: sha}}}
	stored, err := s.Create(ctx, h.organizationID, c)
	lockMust(t, err)
	secondSHA := strings.Repeat("b", 40)
	c.Revisions = append(c.Revisions, delivery.Revision{ID: "r2", CommitSHA: secondSHA})
	stored, err = s.Update(ctx, h.organizationID, c, stored.Version)
	lockMust(t, err)
	stored, err = s.Update(ctx, h.organizationID, c, stored.Version)
	lockMust(t, err)
	slugInsertOrganization(t, ctx, s, "foreign", "foreign", "active")
	_, err = s.Create(ctx, "foreign", c)
	lockMust(t, err)
	s.Close()
	s, err = Open(ctx, dsn)
	lockMust(t, err)
	defer s.Close()
	done := make(chan error, 8)
	for range 8 {
		go func() { done <- s.AdvanceTriggers(ctx) }()
	}
	for range 8 {
		lockMust(t, <-done)
	}
	for range 3 {
		lockMust(t, s.AdvanceTriggers(ctx))
	}
	count := func(sql string, want int) {
		t.Helper()
		var n int
		lockMust(t, s.pool.QueryRow(ctx, sql).Scan(&n))
		if n != want {
			t.Fatalf("%s: got %d, want %d", sql, n, want)
		}
	}
	count(`SELECT count(*) FROM pipeline_runs`, 3)
	count(`SELECT count(*) FROM pipeline_trigger_events WHERE outcome='queued'`, 3)
	count(`SELECT count(*) FROM pipeline_runs WHERE trigger_source->>'kind'='schedule' AND (trigger_source->>'scheduledAt')::timestamptz BETWEEN now()-interval '1 hour' AND now()`, 1)
	var id string
	lockMust(t, s.pool.QueryRow(ctx, `SELECT id FROM pipeline_runs WHERE trigger_source->>'revisionId'='r1'`).Scan(&id))
	r, err := s.GetRun(ctx, h.organizationID, id)
	lockMust(t, err)
	if r.Trigger.SHA != sha || r.Trigger.ChangesetID != "change" || r.Trigger.BindingID == "" {
		t.Fatal("wrong revision source", r.Trigger)
	}
	if _, err = s.GetRun(ctx, "foreign", id); err != pipeline.ErrMissing {
		t.Fatal("foreign run access", err)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE pipeline_runs SET trigger_source=NULL WHERE id=$1`, id); err == nil {
		t.Fatal("rewrote run provenance")
	}
	exec(`UPDATE organization_memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2`, h.organizationID, h.userID)
	c.Revisions = append(c.Revisions, delivery.Revision{ID: "r3", CommitSHA: secondSHA})
	_, err = s.Update(ctx, h.organizationID, c, stored.Version)
	lockMust(t, err)
	lockMust(t, s.AdvanceTriggers(ctx))
	count(`SELECT count(*) FROM pipeline_trigger_events WHERE outcome='denied'`, 1)
	count(`SELECT count(*) FROM pipeline_runs`, 3)
}

func TestRepositoryWorkflowTriggersAndRerun(t *testing.T) {
	ctx := t.Context()
	s, h, _, sha, _ := integrationFixture(t)
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: s, CSRF: s, Pipelines: s, Runs: s, AllowedOrigin: lockHTTPOrigin,
	})
	org, actor := h.organizationID, h.userID
	base := "/api/v1/organizations/" + org
	post := func(path, body string, status int) []byte {
		t.Helper()
		response := h.do(ctx, "POST", base+path, body)
		if response.Code != status {
			t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
		}
		return response.Body.Bytes()
	}
	v, err := s.PipelineVersion(ctx, org, "p", 1)
	lockMust(t, err)
	v.Definition.Parameters = []pipeline.Parameter{
		{Name: "fixed", Type: "string", Default: json.RawMessage(`"standard"`)},
		{Name: "custom", Type: "string", Override: true, Default: json.RawMessage(`"default"`)},
	}
	_, err = s.CreateRepositoryPipeline(ctx, org, "repo-ci", actor, "team/repo", &v.Definition)
	lockMust(t, err)
	post("/pipelines/repo-ci/publish", `{"revision":1}`, 200)
	triggers := "/pipelines/repo-ci/triggers"
	post(triggers, `{"kind":"schedule","version":1,"everySeconds":59}`, 400)
	var schedule pipeline.TriggerBinding
	lockMust(t, json.Unmarshal(post(triggers, `{"kind":"schedule","version":1,"everySeconds":60}`, 201), &schedule))
	post(triggers, `{"kind":"schedule","version":1,"everySeconds":60}`, 409)
	post(triggers, `{"kind":"changeset_revision","version":1}`, 201)
	post(triggers, `{"kind":"tag","version":1}`, 400)
	post(triggers, `{"kind":"tag","version":1,"tagPattern":"../escape"}`, 400)
	var tagBinding pipeline.TriggerBinding
	lockMust(t, json.Unmarshal(post(triggers, `{"kind":"tag","version":1,"tagPattern":"v*"}`, 201), &tagBinding))
	post(triggers, `{"kind":"tag","version":1,"tagPattern":"other-*"}`, 409)
	items, err := s.WorkflowTriggers(ctx, org, "repo-ci")
	lockMust(t, err)
	if len(items) != 3 || schedule.Version != 1 || schedule.EverySeconds != 60 {
		t.Fatalf("unexpected bindings: %v", items)
	}
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_trigger_bindings SET next_due=now()-interval '1 second' WHERE id=$1`, schedule.ID)
	lockMust(t, err)
	workflow := "/pipelines/repo-ci"
	post(workflow+"/disable", `{"revision":1}`, 409)
	var paused pipeline.Pipeline
	lockMust(t, json.Unmarshal(post(workflow+"/disable", `{"revision":2}`, 200), &paused))
	if !paused.Disabled || paused.Version != 1 || paused.Revision != 3 {
		t.Fatalf("disabled workflow lost its publication: %+v", paused.Summary)
	}
	post(workflow+"/versions/1/runs", `{}`, 409)
	changeset := &delivery.Changeset{ID: "while-disabled", Title: "Disable trigger capture", Repository: "team/repo", Revisions: []delivery.Revision{{ID: "r1", CommitSHA: sha}}}
	stored, err := s.Create(ctx, org, changeset)
	lockMust(t, err)
	lockMust(t, s.AdvanceTriggers(ctx))
	var eventCount int
	lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM pipeline_trigger_events`).Scan(&eventCount))
	if eventCount != 0 {
		t.Fatalf("disabled workflow captured %d events", eventCount)
	}
	post(workflow+"/enable", `{"revision":3}`, 200)
	changeset.Revisions = append(changeset.Revisions, delivery.Revision{ID: "r2", CommitSHA: strings.Repeat("b", 40)})
	_, err = s.Update(ctx, org, changeset, stored.Version)
	lockMust(t, err)
	lockMust(t, s.AdvanceTriggers(ctx))
	lockMust(t, s.AdvanceTriggers(ctx))
	revisions, err := s.ListRepositoryActions(ctx, org, "team/repo", delivery.RepositoryActionFilter{Event: "changeset_revision"}, 10, 0)
	lockMust(t, err)
	if len(revisions) != 1 || revisions[0].SHA != strings.Repeat("b", 40) || revisions[0].Version != 1 {
		t.Fatalf("unexpected resumed revision runs: %+v", revisions)
	}
	rows, err := s.ListRepositoryActions(ctx, org, "team/repo", delivery.RepositoryActionFilter{Event: "schedule"}, 10, 0)
	lockMust(t, err)
	if len(rows) != 1 || rows[0].Version != 1 {
		t.Fatalf("unexpected scheduled runs: %v", rows)
	}
	disable := h.do(ctx, "DELETE", base+triggers+"/"+schedule.ID, "")
	if disable.Code != 204 {
		t.Fatalf("disable: %d %s", disable.Code, disable.Body.String())
	}
	items, err = s.WorkflowTriggers(ctx, org, "repo-ci")
	lockMust(t, err)
	if len(items) != 2 || items[0].Kind != "changeset_revision" {
		t.Fatalf("remaining bindings: %v", items)
	}
	var original, retry execution.Run
	lockMust(t, json.Unmarshal(post("/pipelines/repo-ci/versions/1/runs", `{"custom":"release"}`, 201), &original))
	runPath := "/pipeline-runs/" + original.ID
	post(runPath+"/rerun", "", 409)
	post(runPath+"/cancel", "", 204)
	lockMust(t, json.Unmarshal(post(runPath+"/rerun", "", 201), &retry))
	if retry.ID == original.ID || retry.Version != original.Version || retry.Status != "queued" || retry.Repository != "team/repo" || retry.Trigger == nil || retry.Trigger.RunID != original.ID {
		t.Fatalf("rerun did not preserve snapshot: %+v", retry)
	}
	if string(retry.Inputs["fixed"]) != `"standard"` || string(retry.Inputs["custom"]) != `"release"` {
		t.Fatalf("rerun did not preserve fixed and overridden inputs: %s", retry.Inputs)
	}
	post(workflow+"/archive", `{"revision":4}`, 200)
	post(workflow+"/enable", `{"revision":5}`, 409)
	post(workflow+"/versions/1/runs", `{}`, 409)
	post(runPath+"/rerun", "", 409)
	if _, err = s.GetRun(ctx, org, retry.ID); err != nil {
		t.Fatalf("archiving removed run history: %v", err)
	}
	_, err = s.pool.Exec(ctx, `UPDATE organization_memberships SET role='member' WHERE organization_id=$1 AND user_id=$2`, org, actor)
	lockMust(t, err)
	post(triggers, `{"kind":"schedule","version":1,"everySeconds":60}`, 403)
	post(workflow+"/disable", `{"revision":5}`, 403)
}
