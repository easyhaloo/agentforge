package postgres

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestProjectCoreHTTP(t *testing.T) {
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
	reader := newLockHTTP(t, fixture, 0)
	member := newLockHTTP(t, fixture, 0)
	outside := newLockHTTP(t, fixture, 0, "team/one", "other/private")
	for _, role := range []struct {
		actor *lockHTTP
		name  string
	}{{reader, "viewer"}, {member, "member"}} {
		_, err := store.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role, status)
			VALUES ($1, $2, $3, 'active')`, owner.organizationID, role.actor.userID, role.name)
		lockMust(t, err)
	}
	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, AllowedOrigin: lockHTTPOrigin,
		ProjectRepo: store, IssueRepo: NewIssueRepository(store),
	})
	for _, actor := range []*lockHTTP{owner, reader, member, outside} {
		actor.handler = handler
	}
	org := "/api/v1/organizations/" + owner.organizationID
	projects := org + "/issue-projects"
	request := func(actor *lockHTTP, method, path, body string, status int, result any) {
		t.Helper()
		res := actor.do(ctx, method, path, body)
		if res.Code != status {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, res.Code, status, res.Body)
		}
		if result != nil {
			lockMust(t, json.Unmarshal(res.Body.Bytes(), result))
		}
	}
	var project issues.Project
	request(owner, http.MethodPost, projects, `{"name":"Release","template":"release_plan"}`, http.StatusCreated, &project)
	if project.Layout != issues.ProjectRoadmap || project.Version != 1 || project.UpdatedAt.IsZero() || project.Repositories == nil ||
		project.Workflows.IssueClosed != "done" || len(project.Views) != 1 || project.Views[0].ID != "default" || project.Views[0].Layout != issues.ProjectRoadmap {
		t.Fatalf("unexpected initial settings: %+v", project)
	}
	projectPath := fmt.Sprintf("%s/%d", projects, project.Number)
	itemsPath := projectPath + "/items"
	request(outside, http.MethodGet, projectPath, "", http.StatusUnauthorized, nil)
	request(outside, http.MethodGet, itemsPath, "", http.StatusUnauthorized, nil)
	request(outside, http.MethodPost, itemsPath, `{"kind":"draft","title":"Outside"}`, http.StatusUnauthorized, nil)
	request(reader, http.MethodGet, projectPath, "", http.StatusOK, nil)
	request(reader, http.MethodGet, itemsPath, "", http.StatusOK, nil)
	request(reader, http.MethodPost, itemsPath, `{"kind":"draft","title":"Forbidden"}`, http.StatusForbidden, nil)
	request(member, http.MethodPatch, projectPath, `{"version":1,"closed":true}`, http.StatusForbidden, nil)
	request(member, http.MethodDelete, projectPath+"?version=1", "", http.StatusForbidden, nil)
	noCSRF := httptest.NewRequest(http.MethodPost, itemsPath, strings.NewReader(`{"kind":"draft","title":"No CSRF"}`)).WithContext(ctx)
	noCSRF.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: owner.credentials.SessionToken})
	noCSRF.Header.Set("Origin", lockHTTPOrigin)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, noCSRF)
	if res.Code != http.StatusForbidden {
		t.Fatalf("write without CSRF: %d %s", res.Code, res.Body)
	}

	for _, body := range []string{
		`{"version":1,"views":null}`,
		`{"version":1,"workflows":{"item_added":"bogus"}}`,
		`{"version":1,"views":[]}`,
		`{"version":1,"views":[{"id":"named","name":"","layout":"board","filter":"","sort":"manual","group":"status"}]}`,
		`{"version":1,"views":[{"id":"default","layout":"board","sort":"manual","group":"status"},{"id":"default","layout":"table","sort":"manual","group":"none"}]}`,
	} {
		request(owner, http.MethodPatch, projectPath, body, http.StatusUnprocessableEntity, nil)
	}
	request(owner, http.MethodPatch, projectPath, `{"version":1,"repositories":["other/private"]}`, http.StatusNotFound, nil)
	request(owner, http.MethodPatch, projectPath, `{"version":1,"name":"Launch","description":"Prepare launch","workflows":{"item_added":"todo","issue_closed":"","pull_request_closed":"done","pull_request_merged":"in_progress"},"readme":"# Release","repositories":["team/two"],"default_repository":"team/one","views":[{"id":"board","name":"Backlog","layout":"board","filter":"status:todo","sort":"priority","group":"status"},{"id":"default","name":"","layout":"roadmap","filter":"","sort":"target_date","group":"none"}]}`, http.StatusOK, &project)
	if project.Version != 2 || project.Layout != issues.ProjectBoard || project.Name != "Launch" || project.Description != "Prepare launch" ||
		project.Readme != "# Release" || len(project.Repositories) != 1 || project.Repositories[0] != "team/two" || project.Views[0].ID != "board" {
		t.Fatalf("unexpected updated settings: %+v", project)
	}
	request(owner, http.MethodPatch, projectPath, `{"version":1,"closed":true}`, http.StatusConflict, nil)
	var directory struct{ Items []issues.Project }
	request(reader, http.MethodGet, projects+"?linked_repository=team%2Ftwo", "", http.StatusOK, &directory)
	if len(directory.Items) != 1 || directory.Items[0].ID != project.ID {
		t.Fatalf("linked repository filter: %+v", directory.Items)
	}
	request(reader, http.MethodGet, projects+"?linked_repository=team%2Fone", "", http.StatusOK, &directory)
	if len(directory.Items) != 0 {
		t.Fatalf("default repository should not imply a linked repository: %+v", directory.Items)
	}

	var source issues.Issue
	request(owner, http.MethodPost, org+"/issues", fmt.Sprintf(`{"repository":"team/one","title":"Issue source","project_ids":[%q]}`, project.ID), http.StatusCreated, &source)
	var listed struct{ Items []issues.ProjectItem }
	request(reader, http.MethodGet, itemsPath, "", http.StatusOK, &listed)
	if len(listed.Items) != 1 || listed.Items[0].Kind != "issue" || listed.Items[0].Number != source.Number {
		t.Fatalf("legacy link was not projected: %+v", listed.Items)
	}
	issueItem := listed.Items[0]
	issueItemPath := itemsPath + "/" + issueItem.ID
	request(member, http.MethodPost, itemsPath, `{"kind":"issue","repository":"team/one","number":1}`, http.StatusOK, &issueItem)
	if issueItem.ID != listed.Items[0].ID {
		t.Fatalf("idempotent add returned a new item: %+v", issueItem)
	}
	request(owner, http.MethodPost, org+"/issues/1/close?repository=team%2Fone", `{"reason":"completed"}`, http.StatusOK, &source)
	request(reader, http.MethodGet, itemsPath, "", http.StatusOK, &listed)
	if source.State != issues.StateClosed || len(listed.Items) != 1 || listed.Items[0].Status != "todo" || listed.Items[0].Version != 1 {
		t.Fatalf("closing the Issue changed project status: source=%s items=%+v", source.State, listed.Items)
	}
	request(reader, http.MethodPatch, issueItemPath, `{"version":1,"status":"done"}`, http.StatusForbidden, nil)
	request(member, http.MethodPatch, issueItemPath, `{"version":1,"title":"Not the issue title"}`, http.StatusUnprocessableEntity, nil)
	request(member, http.MethodPatch, issueItemPath, `{"version":1,"status":"in_progress","priority":"p0","archived":true}`, http.StatusOK, &issueItem)
	request(owner, http.MethodPatch, org+"/issues/1?repository=team%2Fone", fmt.Sprintf(`{"title":"Renamed source","project_ids":[%q]}`, project.ID), http.StatusOK, nil)
	request(reader, http.MethodGet, itemsPath, "", http.StatusOK, &listed)
	if len(listed.Items) != 0 || listed.Items == nil {
		t.Fatalf("expected a non-null empty active list: %+v", listed.Items)
	}
	request(reader, http.MethodGet, itemsPath+"?archived=true", "", http.StatusOK, &listed)
	if len(listed.Items) != 1 || listed.Items[0].ID != issueItem.ID || listed.Items[0].Title != "Renamed source" ||
		listed.Items[0].Status != "in_progress" || listed.Items[0].Priority != "p0" {
		t.Fatalf("legacy source update did not preserve item state: %+v", listed.Items)
	}
	request(member, http.MethodDelete, issueItemPath+"?version=1", "", http.StatusConflict, nil)
	request(member, http.MethodDelete, issueItemPath+"?version=2", "", http.StatusNoContent, nil)
	source = issues.Issue{}
	request(owner, http.MethodGet, org+"/issues/1?repository=team%2Fone", "", http.StatusOK, &source)
	if len(source.Projects) != 0 {
		t.Fatalf("removing the item left its legacy project link: %+v", source.Projects)
	}

	pr, err := delivery.NewChangeset("project-pr", "team/two", "Pull source", owner.userID, time.Now())
	lockMust(t, err)
	pr.PullRequest = &delivery.PullRequest{BaseBranch: "main", SourceBranch: "feature"}
	_, err = store.Create(ctx, owner.organizationID, pr)
	lockMust(t, err)
	request(owner, http.MethodPost, itemsPath, `{"kind":"pull_request","repository":"team/one","source_id":"project-pr"}`, http.StatusNotFound, nil)
	var pullItem issues.ProjectItem
	request(member, http.MethodPost, itemsPath, `{"kind":"pull_request","repository":"team/two","source_id":"project-pr"}`, http.StatusCreated, &pullItem)
	if pullItem.Kind != "pull_request" || pullItem.SourceID != string(pr.ID) || pullItem.Number != 0 || pullItem.Title != pr.Title || pullItem.Status != "todo" {
		t.Fatalf("PR source identity: %+v", pullItem)
	}
	pr.Title = "Updated PR source"
	pr.PullRequest.Closed = true
	_, err = store.Update(ctx, owner.organizationID, pr, 1)
	lockMust(t, err)
	var duplicate issues.ProjectItem
	request(member, http.MethodPost, itemsPath, `{"kind":"pull_request","repository":"team/two","source_id":"project-pr"}`, http.StatusOK, &duplicate)
	if duplicate.ID != pullItem.ID || duplicate.Title != pr.Title || duplicate.Status != "done" || duplicate.Version != pullItem.Version+1 {
		t.Fatalf("PR addition did not preserve the existing item's identity and status: %+v", duplicate)
	}
	removePRPath := itemsPath + "/" + pullItem.ID + "?version=2"
	request(reader, http.MethodDelete, removePRPath, "", http.StatusForbidden, nil)
	request(member, http.MethodDelete, removePRPath, "", http.StatusNoContent, nil)
	request(member, http.MethodPost, itemsPath, `{"kind":"pull_request","repository":"team/two","source_id":"project-pr"}`, http.StatusCreated, &pullItem)
	if pullItem.Status != "todo" {
		t.Fatalf("a closed PR should start with the same project status as any other new item: %+v", pullItem)
	}

	// A subsequent merge uses its own configured status. Later metadata writes must not replay it.
	pr.Merge = &delivery.Merge{ID: "project-pr-merge", CreatedAt: time.Now()}
	_, err = store.Update(ctx, owner.organizationID, pr, 2)
	lockMust(t, err)
	request(member, http.MethodPatch, itemsPath+"/"+pullItem.ID, `{"version":1,"status":"todo"}`, http.StatusConflict, nil)
	request(member, http.MethodPost, itemsPath, `{"kind":"pull_request","repository":"team/two","source_id":"project-pr"}`, http.StatusOK, &duplicate)
	if duplicate.Status != "in_progress" || duplicate.Version != 2 {
		t.Fatalf("merge did not use its configured workflow: %+v", duplicate)
	}
	request(member, http.MethodPatch, itemsPath+"/"+pullItem.ID, `{"version":2,"status":"todo"}`, http.StatusOK, nil)
	pr.Title = "Final PR title"
	_, err = store.Update(ctx, owner.organizationID, pr, 3)
	lockMust(t, err)
	request(member, http.MethodPost, itemsPath, `{"kind":"pull_request","repository":"team/two","source_id":"project-pr"}`, http.StatusOK, &duplicate)
	if duplicate.Status != "todo" || duplicate.Version != 3 {
		t.Fatalf("a metadata write replayed a prior merge: %+v", duplicate)
	}

	var draft issues.ProjectItem
	request(member, http.MethodPost, itemsPath, `{"kind":"draft","title":"Ship it"}`, http.StatusCreated, &draft)
	draftPath := itemsPath + "/" + draft.ID
	request(member, http.MethodPatch, draftPath, `{"version":1,"target_date":"2026-02-30"}`, http.StatusUnprocessableEntity, nil)
	request(member, http.MethodPatch, draftPath, `{"version":1,"status":"done","priority":"p1","start_date":"2026-11-20","target_date":"2026-11-23","iteration":"Sprint 1"}`, http.StatusOK, &draft)
	request(member, http.MethodPatch, draftPath, `{"version":2,"target_date":"2026-11-19"}`, http.StatusUnprocessableEntity, nil)
	request(member, http.MethodPost, draftPath+"/convert", `{"version":2,"repository":"team/one"}`, http.StatusForbidden, nil)
	request(owner, http.MethodPost, draftPath+"/convert", `{"version":1,"repository":"team/one"}`, http.StatusConflict, nil)
	var converted issues.ProjectItem
	request(owner, http.MethodPost, draftPath+"/convert", `{"version":2,"repository":"team/one"}`, http.StatusOK, &converted)
	if converted.ID != draft.ID || converted.Kind != "issue" || converted.Title != draft.Title || converted.Number != 2 || converted.Version != 3 ||
		converted.Status != draft.Status || converted.Priority != draft.Priority || converted.StartDate != draft.StartDate ||
		converted.TargetDate != draft.TargetDate || converted.Iteration != draft.Iteration {
		t.Fatalf("conversion lost fields or consumed an extra number: draft=%+v converted=%+v", draft, converted)
	}
	request(owner, http.MethodPost, draftPath+"/convert", `{"version":2,"repository":"team/one"}`, http.StatusConflict, nil)
	source = issues.Issue{}
	request(owner, http.MethodGet, org+"/issues/2?repository=team%2Fone", "", http.StatusOK, &source)
	if len(source.Projects) != 1 || source.Projects[0].ID != project.ID || source.State != issues.StateOpen {
		t.Fatalf("conversion did not create a normal linked Issue: %+v", source)
	}

	// Move the start and the first item event to yesterday to verify the reverse tally.
	_, err = store.pool.Exec(ctx, `UPDATE organization_projects SET history_since = now() - interval '1 day' WHERE organization_id = $1 AND id = $2`, owner.organizationID, project.ID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `UPDATE project_status_history SET occurred_at = now() - interval '1 day'
		WHERE organization_id = $1 AND project_id = $2 AND ctid IN (
			SELECT ctid FROM project_status_history WHERE organization_id = $1 AND project_id = $2
			AND previous_status IS NULL AND next_status = 'todo' ORDER BY occurred_at LIMIT 1
		)`, owner.organizationID, project.ID)
	lockMust(t, err)
	var history struct{ Items []issues.ProjectStatusDay }
	request(outside, http.MethodGet, projectPath+"/status-history", "", http.StatusUnauthorized, nil)
	request(reader, http.MethodGet, projectPath+"/status-history", "", http.StatusOK, &history)
	if len(history.Items) != 2 || history.Items[0].Todo != 1 || history.Items[0].Done != 0 ||
		history.Items[1].Todo != 1 || history.Items[1].Done != 1 || history.Items[1].InProgress != 0 {
		t.Fatalf("unexpected project history: %+v", history.Items)
	}

	request(owner, http.MethodPatch, projectPath, `{"version":2,"closed":true}`, http.StatusOK, &project)
	if !project.Closed || project.Version != 3 || len(project.Views) != 2 {
		t.Fatalf("closing project lost settings: %+v", project)
	}
	request(member, http.MethodPost, itemsPath, `{"kind":"draft","title":"Closed"}`, http.StatusConflict, nil)
	request(member, http.MethodPatch, draftPath, `{"version":3,"archived":true}`, http.StatusConflict, nil)
	request(reader, http.MethodGet, itemsPath, "", http.StatusOK, nil)
	request(owner, http.MethodPost, org+"/issues", fmt.Sprintf(`{"repository":"team/one","title":"Do not link","project_ids":[%q]}`, project.ID), http.StatusUnprocessableEntity, nil)
	request(owner, http.MethodPatch, projectPath, `{"version":3,"closed":false}`, http.StatusOK, &project)
	request(member, http.MethodPatch, draftPath, `{"version":3,"archived":true}`, http.StatusOK, nil)
	request(owner, http.MethodDelete, projectPath+"?version=3", "", http.StatusConflict, nil)
	request(owner, http.MethodDelete, projectPath+"?version=4", "", http.StatusNoContent, nil)
	request(reader, http.MethodGet, itemsPath, "", http.StatusNotFound, nil)
	source = issues.Issue{}
	request(owner, http.MethodGet, org+"/issues/2?repository=team%2Fone", "", http.StatusOK, &source)
	if len(source.Projects) != 0 {
		t.Fatalf("deleting project left its Issue links: %+v", source.Projects)
	}
	var next issues.Project
	request(owner, http.MethodPost, projects, `{"name":"Next","template":"team_backlog"}`, http.StatusCreated, &next)
	if next.Number <= project.Number || next.Layout != issues.ProjectBoard || next.Views[0].Group != "status" {
		t.Fatalf("project number was reused or template was not initialized: %+v", next)
	}
}
