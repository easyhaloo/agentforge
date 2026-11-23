package postgres

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestRepositoryActionsPolicy(t *testing.T) {
	ctx := t.Context()
	s, h, git, sha, _ := integrationFixture(t)
	org, actor, repo := h.organizationID, h.userID, "team/repo"
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: s, CSRF: s, Catalog: s, Pipelines: s, Runs: s, Git: git, Preview: git, AllowedOrigin: lockHTTPOrigin,
	})
	base := "/api/v1/organizations/" + org
	repoAPI := "/repositories/" + repo
	workflow := "/pipelines/repo-ci"
	version := workflow + "/versions/1"
	request := func(method, path, body string, want int) []byte {
		t.Helper()
		response := h.do(ctx, method, base+path, body)
		if response.Code != want {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, response.Code, want, response.Body.String())
		}
		return response.Body.Bytes()
	}
	setPolicy := func(prior delivery.RepositoryMetadata, disabled bool, status int) delivery.RepositoryMetadata {
		t.Helper()
		payload := fmt.Sprintf(`{"actions_disabled":%t,"updated_at":%q}`, disabled, prior.UpdatedAt.Format(time.RFC3339Nano))
		body := request("PATCH", repoAPI+"/settings", payload, status)
		var updated delivery.RepositoryMetadata
		if status == 200 {
			lockMust(t, json.Unmarshal(body, &updated))
			if updated.ActionsDisabled != disabled {
				t.Fatalf("wrong settings response: %s", body)
			}
		}
		return updated
	}
	def, err := s.PipelineVersion(ctx, org, "p", 1)
	lockMust(t, err)
	_, err = s.CreateRepositoryPipeline(ctx, org, "repo-ci", actor, repo, &def.Definition)
	lockMust(t, err)
	request("POST", workflow+"/publish", `{"revision":1}`, 200)
	schedule, err := s.EnableWorkflowTrigger(ctx, org, "repo-ci", actor, "schedule", 1, 60)
	lockMust(t, err)
	binding, err := s.EnableWorkflowTrigger(ctx, org, "repo-ci", actor, "changeset_revision", 1, 0)
	lockMust(t, err)
	var prior execution.Run
	lockMust(t, json.Unmarshal(request("POST", version+"/runs", `{}`, 201), &prior))
	runPath := "/pipeline-runs/" + prior.ID
	request("POST", runPath+"/cancel", "", 204)
	items, err := s.ListRepositories(ctx, org)
	lockMust(t, err)
	if len(items) != 1 || items[0].ActionsDisabled {
		t.Fatalf("existing repositories must start enabled: %+v", items)
	}
	patchRole := func(role string) {
		t.Helper()
		_, err := s.pool.Exec(ctx, `UPDATE organization_memberships SET role=$3 WHERE organization_id=$1 AND user_id=$2`, org, actor, role)
		lockMust(t, err)
	}
	patchRole("member")
	setPolicy(items[0], true, 403)
	patchRole("owner")
	disabled := setPolicy(items[0], true, 200)
	setPolicy(items[0], false, 409)
	var loaded delivery.RepositoryMetadata
	lockMust(t, json.Unmarshal(request("GET", repoAPI+"/settings", "", 200), &loaded))
	if !loaded.ActionsDisabled || !loaded.UpdatedAt.Equal(disabled.UpdatedAt) {
		t.Fatalf("settings read did not expose the repository policy and version: %+v", loaded)
	}
	for _, path := range []string{version + "/runs", runPath + "/rerun"} {
		body := request("POST", path, `{}`, 403)
		var problem struct{ Title string }
		lockMust(t, json.Unmarshal(body, &problem))
		if problem.Title != "Repository Actions disabled" {
			t.Fatalf("wrong policy error: %s", body)
		}
	}
	request("GET", runPath, "", 200)
	request("POST", "/pipelines/p/versions/1/runs", `{}`, 201)
	request("POST", "/pipelines/p/versions/1/integration-runs", `{"repository":"team/repo","target":"main","sources":["topic"]}`, 403)
	_, err = s.TriggerRun(ctx, org, "repo-ci", 1, actor, execution.Webhook{Hook: "hook", Delivery: "delivery", Digest: "digest"})
	if !errors.Is(err, execution.ErrRepositoryActionsDisabled) {
		t.Fatalf("webhook admission: %v", err)
	}
	changeset := &delivery.Changeset{ID: "while-actions-disabled", Title: "Do not start a run", Repository: repo, Revisions: []delivery.Revision{{ID: "r1", CommitSHA: sha}}}
	stored, err := s.Create(ctx, org, changeset)
	lockMust(t, err)
	_, err = s.pool.Exec(ctx, `UPDATE pipeline_trigger_bindings SET next_due=now()-interval '1 second' WHERE id=$1`, schedule.ID)
	lockMust(t, err)
	lockMust(t, s.AdvanceTriggers(ctx))
	var count int
	lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM pipeline_trigger_events`).Scan(&count))
	if count != 0 {
		t.Fatalf("disabled Actions captured %d events", count)
	}
	// A revision captured before the policy changed still has to pass admission.
	_, err = s.pool.Exec(ctx, `INSERT INTO pipeline_trigger_events(binding_id,source) VALUES($1,jsonb_build_object('kind','changeset_revision','repository',$2::text,'revisionId','pending'))`, binding.ID, repo)
	lockMust(t, err)
	lockMust(t, s.AdvanceTriggers(ctx))
	var outcome string
	lockMust(t, s.pool.QueryRow(ctx, `SELECT outcome FROM pipeline_trigger_events WHERE source->>'revisionId'='pending'`).Scan(&outcome))
	if outcome != "disabled" {
		t.Fatalf("pending event outcome: %s", outcome)
	}
	setPolicy(disabled, false, 200)
	request("POST", runPath+"/rerun", "", 201)
	changeset.Revisions = append(changeset.Revisions, delivery.Revision{ID: "r2", CommitSHA: sha})
	_, err = s.Update(ctx, org, changeset, stored.Version)
	lockMust(t, err)
	lockMust(t, s.AdvanceTriggers(ctx))
	lockMust(t, s.pool.QueryRow(ctx, `SELECT count(*) FROM pipeline_trigger_events WHERE outcome='queued' AND source->>'revisionId'='r2'`).Scan(&count))
	if count != 1 {
		t.Fatalf("new revisions did not run after re-enabling Actions: %d", count)
	}
}
