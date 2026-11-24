package postgres

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/comments"
	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestRepositoryIssuesSetting(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	const repo, other = "team/repo", "team/other"
	h := newLockHTTP(t, &lockFixture{ctx: ctx, store: store}, 0, repo, other)
	repository := NewIssueRepository(store)
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, AllowedOrigin: lockHTTPOrigin,
		IssueRepo: repository, IssueDetailRepo: repository, CommentRepo: NewCommentRepository(store), ProjectRepo: store,
	})
	base := "/api/v1/organizations/" + h.organizationID
	issuesPath := base + "/issues"
	settingsPath := base + "/repositories/" + repo + "/settings"
	query := "?repository=" + url.QueryEscape(repo)
	request := func(method, route, body string, status int) string {
		t.Helper()
		response := h.do(ctx, method, route, body)
		if response.Code != status {
			t.Fatalf("%s %s returned %d, want %d: %s", method, route, response.Code, status, response.Body)
		}
		return response.Body.String()
	}
	var settings delivery.RepositoryMetadata
	lockMust(t, json.Unmarshal([]byte(request("GET", settingsPath, "", 200)), &settings))
	if settings.IssuesDisabled {
		t.Fatal("issues should be enabled by default")
	}
	const body = `{"repository":"team/repo","title":"Existing issue"}`
	request("POST", issuesPath, body, 201)
	request("POST", issuesPath, `{"repository":"team/other","title":"Other repository issue"}`, 201)
	projectsPath := base + "/issue-projects"
	var project issues.Project
	lockMust(t, json.Unmarshal([]byte(request("POST", projectsPath, `{"name":"Repository issues"}`, 201)), &project))
	itemsPath := fmt.Sprintf("%s/%d/items", projectsPath, project.Number)
	const importIssue = `{"kind":"issue","repository":"team/repo","number":1}`
	var linked, draft issues.ProjectItem
	lockMust(t, json.Unmarshal([]byte(request("POST", itemsPath, importIssue, 201)), &linked))
	lockMust(t, json.Unmarshal([]byte(request("POST", itemsPath, `{"kind":"draft","title":"Project draft"}`, 201)), &draft))
	conversionPath := itemsPath + "/" + draft.ID + "/convert"
	conversion := fmt.Sprintf(`{"version":%d,"repository":%q}`, draft.Version, repo)
	assertProjectItems := func(want ...issues.ProjectItem) {
		t.Helper()
		var listed struct{ Items []issues.ProjectItem }
		lockMust(t, json.Unmarshal([]byte(request("GET", itemsPath, "", 200)), &listed))
		got := make(map[string]int64, len(listed.Items))
		for _, item := range listed.Items {
			got[item.ID] = item.Version
		}
		if len(got) != len(want) {
			t.Fatalf("unexpected project items: %+v", listed.Items)
		}
		for _, item := range want {
			if got[item.ID] != item.Version {
				t.Fatalf("project item missing or changed: want %+v, got %+v", item, listed.Items)
			}
		}
	}
	issuePath := issuesPath + "/1"
	request("GET", issuePath+query, "", 200)
	var comment comments.Comment
	lockMust(t, json.Unmarshal([]byte(request("POST", issuePath+"/comments"+query, `{"body":"Existing comment"}`, 201)), &comment))
	commentPath := base + "/comments/" + string(comment.ID)
	const attachmentID = "1234567890abcdef1234567890abcdef"
	lockMust(t, repository.StageAttachment(ctx, h.organizationID, issues.AttachmentDraft{
		ID: attachmentID, Repository: repo, UploaderID: h.userID, Filename: "issue.txt",
		ContentType: "application/octet-stream", Content: []byte("Issue attachment"),
	}))
	attachmentPath := base + "/issue-attachments/" + attachmentID
	request("GET", commentPath, "", 200)
	request("GET", attachmentPath, "", 200)
	var otherIssue issues.Issue
	lockMust(t, json.Unmarshal([]byte(request("GET", issuePath+"?repository="+url.QueryEscape(other), "", 200)), &otherIssue))
	setDisabled := func(disabled bool) string {
		t.Helper()
		body := fmt.Sprintf(`{"issues_disabled":%t,"updated_at":%q}`, disabled, settings.UpdatedAt.Format(time.RFC3339Nano))
		lockMust(t, json.Unmarshal([]byte(request("PATCH", settingsPath, body, 200)), &settings))
		if settings.IssuesDisabled != disabled {
			t.Fatalf("issues_disabled = %t, want %t", settings.IssuesDisabled, disabled)
		}
		return body
	}
	stale := setDisabled(true)
	assertProjectItems(draft)
	request("POST", itemsPath, importIssue, 404)
	request("PATCH", itemsPath+"/"+linked.ID, fmt.Sprintf(`{"version":%d,"status":"done"}`, linked.Version), 404)
	request("DELETE", fmt.Sprintf("%s/%s?version=%d", itemsPath, linked.ID, linked.Version), "", 404)
	request("POST", conversionPath, conversion, 404)
	assertProjectItems(draft)
	request("PATCH", settingsPath, stale, 409)
	request("GET", issuePath+query, "", 404)
	request("POST", issuesPath, body, 404)
	request("POST", issuePath+"/comments"+query, `{"body":"Blocked comment"}`, 404)
	request("GET", commentPath, "", 404)
	request("PATCH", commentPath, `{"body":"Blocked edit"}`, 404)
	request("DELETE", commentPath, "", 404)
	request("GET", attachmentPath, "", 404)
	request("POST", issuePath+"/transfer?repository="+url.QueryEscape(other),
		fmt.Sprintf(`{"repository":%q,"expected_updated_at":%q}`, repo, otherIssue.UpdatedAt.Format(time.RFC3339Nano)), 404)
	changeset, err := delivery.NewChangeset("linked-pr", repo, "Linked pull request", h.userID, time.Now().UTC())
	lockMust(t, err)
	changeset.PullRequest = &delivery.PullRequest{BaseBranch: "main", SourceBranch: "topic"}
	_, err = repository.CreateLinkedPullRequest(ctx, issues.DetailScope{
		OrganizationID: h.organizationID, Repository: repo, Number: 1, UserID: h.userID, CanManage: true,
	}, changeset)
	if !errors.Is(err, issues.ErrDetailNotFound) {
		t.Fatalf("linked pull request against disabled issues returned %v", err)
	}
	if got := request("GET", issuesPath+"/references"+query+"&number=1", "", 200); strings.TrimSpace(got) != "[]" {
		t.Fatalf("disabled issue appears in references: %s", got)
	}
	listed := request("GET", issuesPath, "", 200)
	if strings.Contains(listed, `"title":"Existing issue"`) || !strings.Contains(listed, `"title":"Other repository issue"`) {
		t.Fatalf("organization listing includes the wrong issues: %s", listed)
	}
	setDisabled(false)
	assertProjectItems(linked, draft)
	var converted issues.ProjectItem
	lockMust(t, json.Unmarshal([]byte(request("POST", conversionPath, conversion, 200)), &converted))
	if converted.ID != draft.ID || converted.Kind != "issue" || converted.Number != 2 {
		t.Fatalf("failed conversion did not roll back cleanly: %+v", converted)
	}
	request("GET", commentPath, "", 200)
	request("GET", attachmentPath, "", 200)
	if got := request("GET", issuePath+query, "", 200); !strings.Contains(got, `"title":"Existing issue"`) {
		t.Fatalf("existing issue was not restored: %s", got)
	}
}
