package postgres

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestProjectWorkflowRunsHTTP(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	fixture := &lockFixture{ctx: ctx, store: store}
	owner := newLockHTTP(t, fixture, 0, "team/one", "team/two")
	member := newLockHTTP(t, fixture, 0)
	_, err = store.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role, status)
		VALUES ($1, $2, 'member', 'active')`, owner.organizationID, member.userID)
	lockMust(t, err)
	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, AllowedOrigin: lockHTTPOrigin,
		ProjectRepo: store, IssueRepo: NewIssueRepository(store),
	})
	owner.handler, member.handler = handler, handler
	org := "/api/v1/organizations/" + owner.organizationID
	projects := org + "/issue-projects"
	request := func(actor *lockHTTP, method, path, body string, status int, result any) {
		t.Helper()
		res := actor.do(ctx, method, path, body)
		if res.Code != status {
			t.Fatalf("%s %s returned %d, want %d: %s", method, path, res.Code, status, res.Body)
		}
		if result != nil {
			lockMust(t, json.Unmarshal(res.Body.Bytes(), result))
		}
	}
	var project, other issues.Project
	request(owner, http.MethodPost, projects, `{"name":"Release","layout":"table"}`, http.StatusCreated, &project)
	request(owner, http.MethodPost, projects, `{"name":"Manual","layout":"table"}`, http.StatusCreated, &other)
	projectPath := fmt.Sprintf("%s/%d", projects, project.Number)
	otherPath := fmt.Sprintf("%s/%d", projects, other.Number)
	runsPath := projectPath + "/workflow-runs"
	request(member, http.MethodGet, runsPath, "", http.StatusForbidden, nil)
	request(owner, http.MethodGet, projects+"/9999/workflow-runs", "", http.StatusNotFound, nil)
	request(owner, http.MethodPatch, projectPath, `{"version":1,"workflows":{"item_added":"todo","auto_archive_days":366}}`, http.StatusUnprocessableEntity, nil)
	request(owner, http.MethodPatch, projectPath, `{"version":1,"workflows":{"item_added":"todo","issue_closed":"done","auto_archive_days":2}}`, http.StatusOK, &project)
	if project.Workflows.AutoArchiveDays != 2 {
		t.Fatalf("archive threshold was not persisted: %+v", project.Workflows)
	}
	var issue issues.Issue
	request(owner, http.MethodPost, org+"/issues", fmt.Sprintf(`{"repository":"team/one","title":"Ship release","project_ids":[%q]}`, project.ID), http.StatusCreated, &issue)
	request(owner, http.MethodPost, fmt.Sprintf("%s/issues/%d/close?repository=team%%2Fone", org, issue.Number), `{"reason":"completed"}`, http.StatusOK, nil)
	var recent, manual issues.ProjectItem
	request(owner, http.MethodPost, projectPath+"/items", `{"kind":"draft","title":"Recent","status":"done"}`, http.StatusCreated, &recent)
	request(owner, http.MethodPost, otherPath+"/items", `{"kind":"draft","title":"Manual","status":"done"}`, http.StatusCreated, &manual)
	_, err = store.pool.Exec(ctx, `UPDATE project_items SET done_since = now() - interval '3 days'
		WHERE organization_id = $1 AND (issue_id = $2 OR id = $3)`, owner.organizationID, issue.ID, manual.ID)
	lockMust(t, err)
	request(owner, http.MethodPatch, projectPath, `{"version":2,"closed":true}`, http.StatusOK, &project)
	now := time.Now()
	lockMust(t, store.archiveDoneProjectItems(ctx, now))
	var items struct{ Items []issues.ProjectItem }
	request(owner, http.MethodGet, projectPath+"/items?archived=true", "", http.StatusOK, &items)
	if len(items.Items) != 0 {
		t.Fatalf("archived in a closed project: %+v", items.Items)
	}
	request(owner, http.MethodPatch, projectPath, `{"version":3,"closed":false}`, http.StatusOK, &project)
	lockMust(t, store.archiveDoneProjectItems(ctx, now))
	lockMust(t, store.archiveDoneProjectItems(ctx, now))
	request(owner, http.MethodGet, projectPath+"/items?archived=true", "", http.StatusOK, &items)
	if len(items.Items) != 1 || items.Items[0].Title != issue.Title || items.Items[0].Version != 3 {
		t.Fatalf("expected one archived Issue and one version increment: %+v", items.Items)
	}
	archived := items.Items[0]
	request(owner, http.MethodPatch, projectPath+"/items/"+archived.ID, `{"version":3,"archived":false}`, http.StatusOK, nil)
	lockMust(t, store.archiveDoneProjectItems(ctx, time.Now()))
	request(owner, http.MethodGet, projectPath+"/items?archived=true", "", http.StatusOK, &items)
	if len(items.Items) != 0 {
		t.Fatalf("restored item was immediately archived: %+v", items.Items)
	}
	request(owner, http.MethodGet, otherPath+"/items", "", http.StatusOK, &items)
	if len(items.Items) != 1 || items.Items[0].ID != manual.ID {
		t.Fatalf("archived in a project with the rule disabled: %+v", items.Items)
	}
	var history struct{ Items []issues.ProjectWorkflowRun }
	request(owner, http.MethodGet, runsPath, "", http.StatusOK, &history)
	if len(history.Items) != 2 || history.Items[0].Rule != "auto_archive" || history.Items[0].ItemCount != 1 || history.Items[1].Rule != "issue_closed" {
		t.Fatalf("unexpected newest-first workflow history: %+v", history.Items)
	}
	request(owner, http.MethodGet, otherPath+"/workflow-runs", "", http.StatusOK, &history)
	if history.Items == nil || len(history.Items) != 0 {
		t.Fatalf("unexpected workflow history on another project: %+v", history.Items)
	}

	// A label filter accepts only labels from its selected repository. It does
	// not import old work, nor replay when the same label list is saved again.
	_, err = store.pool.Exec(ctx, `INSERT INTO labels (organization_id, id, repository, name, color)
		VALUES ($1, 'ready', 'team/one', 'Ready', '0052cc'), ($1, 'elsewhere', 'team/two', 'Ready', '0052cc')`, owner.organizationID)
	lockMust(t, err)
	var existing issues.Issue
	request(owner, http.MethodPost, org+"/issues", `{"repository":"team/one","title":"Existing ready issue","label_ids":["ready"]}`, http.StatusCreated, &existing)
	request(owner, http.MethodPatch, otherPath, `{"version":1,"workflows":{"item_added":"in_progress","auto_add":{"repository":"team/one","kind":"issue","label_id":"elsewhere"}}}`, http.StatusUnprocessableEntity, nil)
	request(owner, http.MethodPatch, otherPath, `{"version":1,"workflows":{"item_added":"in_progress","auto_add":{"repository":"team/one","kind":"issue","label_id":"ready"}}}`, http.StatusOK, &other)
	request(owner, http.MethodGet, otherPath+"/items", "", http.StatusOK, &items)
	if len(items.Items) != 1 || items.Items[0].ID != manual.ID {
		t.Fatalf("rule added an existing Issue: %+v", items.Items)
	}
	var candidate issues.Issue
	request(owner, http.MethodPost, org+"/issues", `{"repository":"team/one","title":"New work"}`, http.StatusCreated, &candidate)
	issuePath := fmt.Sprintf("%s/issues/%d?repository=team%%2Fone", org, candidate.Number)
	request(owner, http.MethodPatch, issuePath, `{"label_ids":["ready"]}`, http.StatusOK, nil)
	var linked issues.ProjectItem
	request(owner, http.MethodPost, otherPath+"/items", fmt.Sprintf(`{"kind":"issue","repository":"team/one","number":%d}`, candidate.Number), http.StatusOK, &linked)
	if linked.Status != "in_progress" {
		t.Fatalf("automatic item did not use the initial status workflow: %+v", linked)
	}
	request(owner, http.MethodDelete, otherPath+"/items/"+linked.ID+"?version=1", "", http.StatusNoContent, nil)
	request(owner, http.MethodPatch, issuePath, `{"label_ids":["ready"]}`, http.StatusOK, nil)
	request(owner, http.MethodGet, otherPath+"/items", "", http.StatusOK, &items)
	if len(items.Items) != 1 || items.Items[0].ID != manual.ID {
		t.Fatalf("saving an unchanged label re-added a removed item: %+v", items.Items)
	}
	request(owner, http.MethodPatch, issuePath, `{"label_ids":[]}`, http.StatusOK, nil)
	request(owner, http.MethodPatch, issuePath, `{"label_ids":["ready"]}`, http.StatusOK, nil)
	request(owner, http.MethodGet, otherPath+"/workflow-runs", "", http.StatusOK, &history)
	if len(history.Items) != 2 || history.Items[0].Rule != "auto_add" || history.Items[1].Rule != "auto_add" {
		t.Fatalf("unexpected automatic addition history: %+v", history.Items)
	}

	request(owner, http.MethodPatch, otherPath, `{"version":2,"workflows":{"item_added":"todo","auto_add":{"repository":"team/two","kind":"pull_request"}}}`, http.StatusOK, &other)
	pr, err := delivery.NewChangeset("automated-pr", "team/two", "Publish this change", owner.userID, time.Now())
	lockMust(t, err)
	_, err = store.Create(ctx, owner.organizationID, pr)
	lockMust(t, err)
	request(owner, http.MethodGet, otherPath+"/workflow-runs", "", http.StatusOK, &history)
	if len(history.Items) != 2 {
		t.Fatalf("rule ran for a Changeset without a PR: %+v", history.Items)
	}
	pr.PullRequest = &delivery.PullRequest{BaseBranch: "main", SourceBranch: "feature"}
	_, err = store.Update(ctx, owner.organizationID, pr, 1)
	lockMust(t, err)
	request(owner, http.MethodPost, otherPath+"/items", `{"kind":"pull_request","repository":"team/two","source_id":"automated-pr"}`, http.StatusOK, &linked)
	if linked.Status != "todo" || linked.Kind != "pull_request" {
		t.Fatalf("published PR did not become an automatic item: %+v", linked)
	}

}
