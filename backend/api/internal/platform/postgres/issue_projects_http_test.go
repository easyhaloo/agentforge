package postgres

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestIssueProjectsHTTP(t *testing.T) {
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
	other := newLockHTTP(t, fixture, 0, "team/one")
	deps := httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, AllowedOrigin: lockHTTPOrigin,
		ProjectRepo: store, IssueRepo: NewIssueRepository(store),
	}
	owner.handler = httpserver.NewHandlerWithDependencies(deps)
	other.handler = owner.handler
	orgPath := func(user *lockHTTP) string { return "/api/v1/organizations/" + user.organizationID }
	request := func(user *lockHTTP, method, path, body string, status int) []byte {
		t.Helper()
		response := user.do(ctx, method, path, body)
		if response.Code != status {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, response.Code, status, response.Body)
		}
		return response.Body.Bytes()
	}
	createProject := func(user *lockHTTP, body string) issues.Project {
		t.Helper()
		var project issues.Project
		lockMust(t, json.Unmarshal(request(user, http.MethodPost, orgPath(user)+"/issue-projects", body, http.StatusCreated), &project))
		return project
	}
	orgProject := createProject(owner, `{"name":"Roadmap","layout":"board","default_repository":"team/one"}`)
	repoProject := createProject(owner, `{"name":"Roadmap","repository":"team/one"}`)
	outsideProject := createProject(other, `{"name":"External"}`)
	if orgProject.Number != 1 || repoProject.Number != 2 || outsideProject.Number != 1 {
		t.Fatalf("project numbers must be scoped to the organization: %d, %d, %d", orgProject.Number, repoProject.Number, outsideProject.Number)
	}
	if orgProject.Layout != issues.ProjectBoard || orgProject.DefaultRepository != "team/one" || orgProject.Repository != "" || orgProject.CreatedAt == nil || repoProject.Layout != issues.ProjectTable {
		t.Fatalf("unexpected initial project configuration: %+v, %+v", orgProject, repoProject)
	}
	path := orgPath(owner)
	request(owner, http.MethodPost, path+"/issue-projects", `{"name":"Invalid layout","layout":"timeline"}`, http.StatusUnprocessableEntity)
	request(owner, http.MethodPost, path+"/issue-projects", `{"name":" roadmap "}`, http.StatusConflict)
	request(owner, http.MethodPost, path+"/issue-projects", `{"name":"  "}`, http.StatusUnprocessableEntity)
	request(other, http.MethodGet, path+"/issue-projects", "", http.StatusUnauthorized)
	issueBody := func(repository string, ids ...string) string {
		data, err := json.Marshal(map[string]any{"repository": repository, "title": "Projects contract", "project_ids": ids})
		lockMust(t, err)
		return string(data)
	}
	for _, ids := range [][]string{{orgProject.ID, outsideProject.ID}, {repoProject.ID, repoProject.ID}, {"not-an-id"}} {
		request(owner, http.MethodPost, path+"/issues", issueBody("team/one", ids...), http.StatusUnprocessableEntity)
	}
	request(owner, http.MethodPost, path+"/issues", issueBody("team/two", repoProject.ID), http.StatusUnprocessableEntity)
	var issue issues.Issue
	lockMust(t, json.Unmarshal(request(owner, http.MethodPost, path+"/issues", issueBody("team/one", orgProject.ID, repoProject.ID), http.StatusCreated), &issue))
	if issue.Number != 1 || len(issue.Projects) != 2 {
		t.Fatalf("rejected associations must not consume a number and valid projects must persist: %+v", issue)
	}
	var otherRepoIssue issues.Issue
	lockMust(t, json.Unmarshal(request(owner, http.MethodPost, path+"/issues", issueBody("team/two", orgProject.ID), http.StatusCreated), &otherRepoIssue))
	if otherRepoIssue.Number != 1 || len(otherRepoIssue.Projects) != 1 {
		t.Fatalf("cross-repository association must not create an issue: %+v", otherRepoIssue)
	}
	query := "?repository=" + url.QueryEscape("team/one")
	var detail issues.Issue
	lockMust(t, json.Unmarshal(request(owner, http.MethodGet, path+"/issues/1"+query, "", http.StatusOK), &detail))
	if len(detail.Projects) != 2 || detail.Projects[0].Name != "Roadmap" || detail.Projects[1].Name != "Roadmap" {
		t.Fatalf("expected persisted project names: %+v", detail.Projects)
	}
	listed := func(user *lockHTTP, repository string) []issues.Project {
		t.Helper()
		var result struct{ Items []issues.Project }
		lockMust(t, json.Unmarshal(request(user, http.MethodGet, path+"/issue-projects?repository="+url.QueryEscape(repository), "", http.StatusOK), &result))
		return result.Items
	}
	if projects := listed(owner, "team/two"); len(projects) != 1 || projects[0].ID != orgProject.ID || projects[0].Number != orgProject.Number || projects[0].Layout != issues.ProjectBoard || projects[0].DefaultRepository != "team/one" || !projects[0].Recent {
		t.Fatalf("cross-repository candidates: %+v", projects)
	}
	listIssues := func(user *lockHTTP, projectID string) (result struct {
		Items []issues.Issue `json:"items"`
		issues.ListCounts
	}) {
		t.Helper()
		lockMust(t, json.Unmarshal(request(user, http.MethodGet, orgPath(user)+"/issues?project_id="+url.QueryEscape(projectID), "", http.StatusOK), &result))
		return result
	}
	if result := listIssues(owner, orgProject.ID); len(result.Items) != 2 || result.Total != 2 || result.OpenTotal != 2 {
		t.Fatalf("expected issues across both repositories: %+v", result)
	}
	if result := listIssues(owner, repoProject.ID); len(result.Items) != 1 || result.Items[0].ID != issue.ID || result.Total != 1 {
		t.Fatalf("expected only the issue associated with this project: %+v", result)
	}
	if result := listIssues(other, orgProject.ID); len(result.Items) != 0 || result.Total != 0 {
		t.Fatalf("returned issues from another organization: %+v", result)
	}
	_, err = store.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role, status)
		VALUES ($1, $2, 'member', 'active')`, owner.organizationID, other.userID)
	lockMust(t, err)
	if projects := listed(other, "team/one"); len(projects) != 2 || projects[0].Recent || projects[1].Recent {
		t.Fatalf("recent must be specific to the current account: %+v", projects)
	}
	request(other, http.MethodPost, path+"/issue-projects", `{"name":"Forbidden"}`, http.StatusForbidden)
	request(other, http.MethodPost, path+"/issues", issueBody("team/one", orgProject.ID), http.StatusForbidden)
}
