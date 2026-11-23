package postgres

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestIssueDetailHTTP(t *testing.T) {
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
	member := newLockHTTP(t, fixture, 0, "team/one")
	outsider := newLockHTTP(t, fixture, 0, "team/one", "team/other-org")
	_, err = store.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role, status)
		VALUES ($1, $2, 'member', 'active')`, owner.organizationID, member.userID)
	lockMust(t, err)
	repo := NewIssueRepository(store)
	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, AllowedOrigin: lockHTTPOrigin,
		IssueRepo: repo, IssueDetailRepo: repo,
	})
	owner.handler, member.handler, outsider.handler = handler, handler, handler
	orgPath := "/api/v1/organizations/" + owner.organizationID
	issuePath := func(issue issues.Issue, resource string) string {
		return fmt.Sprintf("%s/issues/%d/%s?repository=%s", orgPath, issue.Number, resource, url.QueryEscape(issue.Repository))
	}
	call := func(t *testing.T, user *lockHTTP, method, path, body string, status int) []byte {
		t.Helper()
		response := user.do(ctx, method, path, body)
		if response.Code != status {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, response.Code, status, response.Body)
		}
		return response.Body.Bytes()
	}
	newIssue := func(t *testing.T, user *lockHTTP, repository, title string) issues.Issue {
		t.Helper()
		var issue issues.Issue
		body := fmt.Sprintf(`{"repository":%q,"title":%q,"body":"original body"}`, repository, title)
		lockMust(t, json.Unmarshal(call(t, user, http.MethodPost, orgPath+"/issues", body, http.StatusCreated), &issue))
		return issue
	}
	parentBody := func(issue issues.Issue) string { return fmt.Sprintf(`{"number":%d}`, issue.Number) }
	parallel := func(t *testing.T, calls []lockCall, expectedA, expectedB int) {
		t.Helper()
		replies := owner.burst(5*time.Second, calls)
		a, b := replies[0].status, replies[1].status
		if (a != expectedA || b != expectedB) && (b != expectedA || a != expectedB) {
			t.Fatalf("concurrent requests = %+v, want one %d and one %d", replies, expectedA, expectedB)
		}
	}

	t.Run("relationships", func(t *testing.T) {
		a := newIssue(t, owner, "team/one", "Parent")
		b := newIssue(t, member, "team/one", "Child")
		c := newIssue(t, owner, "team/one", "Grandchild")
		otherRepo := newIssue(t, owner, "team/two", "Another repository")
		relationships := func(issue issues.Issue) issues.Relationships {
			t.Helper()
			var result issues.Relationships
			lockMust(t, json.Unmarshal(call(t, member, http.MethodGet, issuePath(issue, "relationships"), "", 200), &result))
			return result
		}
		if empty := relationships(a); empty.Parent != nil || empty.Children == nil || len(empty.Children) != 0 {
			t.Fatalf("invalid empty relationships: %+v", empty)
		}
		call(t, outsider, http.MethodGet, issuePath(a, "relationships"), "", 401)
		call(t, member, http.MethodPut, issuePath(b, "parent"), parentBody(a), 403)
		call(t, owner, http.MethodPut, issuePath(a, "parent"), parentBody(a), 409)
		call(t, owner, http.MethodPut, issuePath(otherRepo, "parent"), parentBody(b), 404)
		call(t, owner, http.MethodPut, issuePath(b, "parent"), parentBody(a), 200)
		call(t, owner, http.MethodPut, issuePath(b, "parent"), parentBody(a), 200)
		call(t, owner, http.MethodPut, issuePath(c, "parent"), parentBody(b), 200)
		call(t, owner, http.MethodPut, issuePath(a, "parent"), parentBody(c), 409)
		call(t, owner, http.MethodPut, issuePath(c, "parent"), parentBody(a), 409)
		if got := relationships(a); len(got.Children) != 1 || got.Children[0].ID != b.ID || got.Children[0].Title != b.Title {
			t.Fatalf("invalid children: %+v", got)
		}
		if got := relationships(b); got.Parent == nil || got.Parent.ID != a.ID || len(got.Children) != 1 || got.Children[0].ID != c.ID {
			t.Fatalf("invalid parent and children: %+v", got)
		}
		call(t, member, http.MethodDelete, issuePath(b, "parent"), "", 403)
		call(t, owner, http.MethodDelete, issuePath(b, "parent"), "", 200)
		if got := relationships(a); len(got.Children) != 0 {
			t.Fatalf("unlink did not remove child: %+v", got)
		}
		parallel(t, []lockCall{
			{http.MethodPut, issuePath(a, "parent"), parentBody(b)},
			{http.MethodPut, issuePath(b, "parent"), parentBody(a)},
		}, 200, 409)
	})

	t.Run("artifacts", func(t *testing.T) {
		issue := newIssue(t, owner, "team/one", "Artifact issue")
		target := newIssue(t, owner, "team/one", "Second issue")
		otherRepo := newIssue(t, owner, "team/two", "Other repository")
		const contents = "fixture content\n"
		upload := func(user *lockHTTP, repository string) issues.Artifact {
			t.Helper()
			var file issues.Artifact
			path := orgPath + "/issue-attachments?filename=fixture.txt&repository=" + url.QueryEscape(repository)
			lockMust(t, json.Unmarshal(call(t, user, http.MethodPost, path, contents, 201), &file))
			return file
		}
		draft := upload(owner, issue.Repository)
		memberDraft := upload(member, issue.Repository)
		call(t, member, http.MethodGet, draft.URL, "", 404)
		call(t, owner, http.MethodPut, issuePath(otherRepo, "artifacts/"+draft.ID), "", 404)
		call(t, owner, http.MethodPut, issuePath(issue, "artifacts/"+memberDraft.ID), "", 404)
		call(t, member, http.MethodPut, issuePath(issue, "artifacts/"+memberDraft.ID), "", 403)
		call(t, owner, http.MethodPut, issuePath(issue, "artifacts/"+draft.ID), "", 204)
		call(t, owner, http.MethodPut, issuePath(issue, "artifacts/"+draft.ID), "", 204)
		call(t, owner, http.MethodPut, issuePath(target, "artifacts/"+draft.ID), "", 404)
		var result struct{ Artifacts []issues.Artifact }
		lockMust(t, json.Unmarshal(call(t, member, http.MethodGet, issuePath(issue, "artifacts"), "", 200), &result))
		if len(result.Artifacts) != 1 || result.Artifacts[0].ID != draft.ID || result.Artifacts[0].Size != len(contents) || result.Artifacts[0].Name != "fixture.txt" || result.Artifacts[0].URL != draft.URL {
			t.Fatalf("invalid artifact metadata: %+v", result.Artifacts)
		}
		if downloaded := call(t, member, http.MethodGet, draft.URL+"?download=1", "", 200); string(downloaded) != contents {
			t.Fatalf("downloaded %q", downloaded)
		}
		call(t, outsider, http.MethodGet, draft.URL, "", 401)
		call(t, owner, http.MethodDelete, issuePath(issue, "artifacts/"+draft.ID), "", 204)
		call(t, member, http.MethodGet, draft.URL, "", 404)
		lockMust(t, json.Unmarshal(call(t, owner, http.MethodGet, issuePath(issue, "artifacts"), "", 200), &result))
		if result.Artifacts == nil || len(result.Artifacts) != 0 {
			t.Fatalf("artifact still linked or missing array: %+v", result.Artifacts)
		}
		parallel(t, []lockCall{
			{http.MethodPut, issuePath(issue, "artifacts/"+draft.ID), ""},
			{http.MethodPut, issuePath(target, "artifacts/"+draft.ID), ""},
		}, 204, 404)

		expired := upload(owner, issue.Repository)
		_, err := store.pool.Exec(ctx, `UPDATE issue_attachments SET expires_at = now() - interval '1 second'
			WHERE organization_id = $1 AND id = $2`, owner.organizationID, expired.ID)
		lockMust(t, err)
		call(t, owner, http.MethodPut, issuePath(issue, "artifacts/"+expired.ID), "", 404)
		limitIssue := newIssue(t, owner, "team/one", "Artifact capacity")
		for range 19 {
			file := upload(owner, issue.Repository)
			call(t, owner, http.MethodPut, issuePath(limitIssue, "artifacts/"+file.ID), "", 204)
		}
		parallel(t, []lockCall{
			{http.MethodPut, issuePath(limitIssue, "artifacts/"+upload(owner, issue.Repository).ID), ""},
			{http.MethodPut, issuePath(limitIssue, "artifacts/"+upload(owner, issue.Repository).ID), ""},
		}, 204, 422)

		embedded := upload(owner, issue.Repository)
		var issueWithBody issues.Issue
		body := fmt.Sprintf(`{"repository":%q,"title":"Embedded file","body":%q,"attachment_ids":[%q]}`,
			issue.Repository, "[fixture]("+embedded.URL+")", embedded.ID)
		lockMust(t, json.Unmarshal(call(t, owner, http.MethodPost, orgPath+"/issues", body, 201), &issueWithBody))
		call(t, owner, http.MethodPut, issuePath(issueWithBody, "artifacts/"+embedded.ID), "", 204)
		call(t, owner, http.MethodDelete, issuePath(issueWithBody, "artifacts/"+embedded.ID), "", 204)
		call(t, member, http.MethodGet, embedded.URL, "", 200)
	})

	t.Run("transfer scope and concurrent requests", func(t *testing.T) {
		_, err := store.RegisterRepository(ctx, delivery.RepositoryMetadata{
			OrganizationID: owner.organizationID, Slug: "team/public", DefaultBranch: "main",
			Visibility: "public", CreatedBy: owner.userID,
		})
		lockMust(t, err)
		issue := newIssue(t, owner, "team/one", "Transfer candidate")
		transferPath := issuePath(issue, "transfer")
		body := func(destination string, expected time.Time) string {
			return fmt.Sprintf(`{"repository":%q,"expected_updated_at":%q}`, destination, expected.Format(time.RFC3339Nano))
		}
		request := body("team/two", issue.UpdatedAt)
		call(t, member, http.MethodPost, transferPath, request, http.StatusForbidden)
		call(t, owner, http.MethodPost, transferPath, body("team/other-org", issue.UpdatedAt), http.StatusNotFound)
		call(t, owner, http.MethodPost, transferPath, body("team/public", issue.UpdatedAt), http.StatusUnprocessableEntity)
		call(t, owner, http.MethodPost, transferPath, body("team/two", issue.UpdatedAt.Add(-time.Second)), http.StatusConflict)
		prior := newIssue(t, owner, "team/two", "Already in destination")
		calls := []lockCall{{http.MethodPost, transferPath, request}, {http.MethodPost, transferPath, request}}
		replies := owner.burst(5*time.Second, calls)
		if lockCount(replies, http.StatusOK) != 1 || lockCount(replies, http.StatusNotFound) != 1 {
			t.Fatalf("expected one move and one rejected retry, got %s", lockStatuses(replies))
		}
		oldPath := strings.Replace(issuePath(issue, ""), "/?", "?", 1)
		var moved issues.Issue
		lockMust(t, json.Unmarshal(call(t, member, http.MethodGet, oldPath, "", http.StatusOK), &moved))
		if moved.ID != issue.ID || moved.Repository != "team/two" || moved.Number != prior.Number+1 {
			t.Fatalf("unexpected moved issue: %+v", moved)
		}
		if next := newIssue(t, owner, "team/two", "After transfer"); next.Number != moved.Number+1 {
			t.Fatalf("rejected transfer consumed a destination number: got %d after %d", next.Number, moved.Number)
		}
	})

	t.Run("reports", func(t *testing.T) {
		issue := newIssue(t, owner, "team/one", "Reported issue")
		otherIssue := newIssue(t, owner, "team/two", "Other repository")
		const commentID = "report-test-comment"
		_, err := store.pool.Exec(ctx, `INSERT INTO comments (organization_id, id, resource_type, resource_id, author_id, body)
			VALUES ($1, $2, 'issue', $3, $4, 'reported comment')`, owner.organizationID, commentID, issue.ID, owner.userID)
		lockMust(t, err)
		path := issuePath(issue, "reports")
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"reason":"spam"}`))
		request.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: member.credentials.SessionToken})
		request.Header.Set("Origin", lockHTTPOrigin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("missing CSRF = %d: %s", response.Code, response.Body)
		}
		call(t, outsider, http.MethodPost, path, `{"reason":"spam"}`, 401)
		call(t, member, http.MethodPost, path, `{"reason":"invalid"}`, 422)
		call(t, member, http.MethodPost, path, fmt.Sprintf(`{"reason":"spam","details":%q}`, strings.Repeat("字", 2001)), 422)
		commentReport := fmt.Sprintf(`{"reason":"harassment","details":"private details","commentId":%q}`, commentID)
		call(t, member, http.MethodPost, issuePath(otherIssue, "reports"), commentReport, 404)
		data := call(t, member, http.MethodPost, path, commentReport, 201)
		var receipt issues.ReportReceipt
		lockMust(t, json.Unmarshal(data, &receipt))
		if receipt.ID == "" || receipt.CreatedAt.IsZero() || strings.Contains(string(data), "private details") {
			t.Fatalf("invalid private receipt: %s", data)
		}
		call(t, member, http.MethodPost, path, commentReport, 409)
		parallel(t, []lockCall{
			{http.MethodPost, path, `{"reason":"spam"}`},
			{http.MethodPost, path, `{"reason":"spam"}`},
		}, 201, 409)
		var reporterID, reportedIssue, reportedComment, reason, details string
		lockMust(t, store.pool.QueryRow(ctx, `SELECT reporter_id, issue_id, comment_id, reason, details
			FROM issue_content_reports WHERE organization_id = $1 AND id = $2`, owner.organizationID, receipt.ID).
			Scan(&reporterID, &reportedIssue, &reportedComment, &reason, &details))
		if reporterID != member.userID || reportedIssue != string(issue.ID) || reportedComment != commentID || reason != "harassment" || details != "private details" {
			t.Fatalf("stored report has wrong principal, resource, or contents")
		}
		var persisted issues.Issue
		path = strings.Replace(path, "/reports?", "?", 1)
		lockMust(t, json.Unmarshal(call(t, owner, http.MethodGet, path, "", 200), &persisted))
		if persisted.Body != issue.Body || !persisted.UpdatedAt.Equal(issue.UpdatedAt) {
			t.Fatalf("report mutated issue contents or timestamp")
		}
	})
}
