package postgres

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestIssueHTTPContract(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	repository := "team/repo"
	h := newLockHTTP(t, &lockFixture{ctx: ctx, store: store}, 0, repository, "team/other")
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, AllowedOrigin: lockHTTPOrigin,
		IssueRepo: NewIssueRepository(store), CommentRepo: NewCommentRepository(store),
	})
	base := "/api/v1/organizations/" + h.organizationID + "/issues"
	query := "?repository=" + url.QueryEscape(repository)
	request := func(method, route, body string, status int) []byte {
		t.Helper()
		response := h.do(ctx, method, route, body)
		if response.Code != status {
			t.Fatalf("%s %s returned %d, want %d: %s", method, route, response.Code, status, response.Body)
		}
		return response.Body.Bytes()
	}
	type issueResponse struct {
		ID          string `json:"id"`
		Number      int    `json:"number"`
		State       string `json:"state"`
		StateReason string `json:"state_reason"`
		CreatedBy   string `json:"created_by"`
		ClosedBy    string `json:"closed_by"`
		ClosedAt    string `json:"closed_at"`
		MilestoneID string `json:"milestone_id"`
		Comments    int    `json:"comments"`
		Labels      []struct {
			Name string `json:"name"`
		} `json:"labels"`
		Assignees []struct {
			UserID string `json:"user_id"`
		} `json:"assignees"`
	}
	decode := func(data []byte) issueResponse {
		t.Helper()
		var issue issueResponse
		lockMust(t, json.Unmarshal(data, &issue))
		return issue
	}
	create := func(repository, title string) issueResponse {
		t.Helper()
		body := fmt.Sprintf(`{"repository":%q,"title":%q,"body":"Issue body"}`, repository, title)
		return decode(request(http.MethodPost, base, body, http.StatusCreated))
	}
	type optionsResponse struct {
		Authors    []string `json:"authors"`
		Labels     []string `json:"labels"`
		Assignees  []string `json:"assignees"`
		Milestones []string `json:"milestones"`
	}
	var empty struct {
		Items         []issueResponse `json:"items"`
		FilterOptions optionsResponse `json:"filter_options"`
	}
	lockMust(t, json.Unmarshal(request(http.MethodGet, base+query+"&include_filter_options=true", "", http.StatusOK), &empty))
	if empty.Items == nil || !reflect.DeepEqual(empty.FilterOptions, optionsResponse{[]string{}, []string{}, []string{}, []string{}}) {
		t.Fatalf("an empty repository must return arrays: %+v", empty)
	}
	first := create(repository, "First")
	if first.Number != 1 || first.State != "open" || first.CreatedBy != h.userID || first.Labels == nil || first.Assignees == nil {
		t.Fatalf("create response did not match the Issue JSON contract: %+v", first)
	}
	second := create(repository, "Second")
	other := create("team/other", "Other")
	var references []int
	lockMust(t, json.Unmarshal(request(http.MethodGet, base+"/references"+query+"&number=1&number=2&number=9999", "", http.StatusOK), &references))
	if !reflect.DeepEqual(references, []int{1, 2}) {
		t.Fatalf("reference lookup must return only existing numbers in the repository: %v", references)
	}
	lockMust(t, json.Unmarshal(request(http.MethodGet, base+"/references?repository=team%2Fother&number=2", "", http.StatusOK), &references))
	if references == nil || len(references) != 0 {
		t.Fatalf("reference lookup must not link to a different repository: %v", references)
	}
	request(http.MethodGet, base+"/references"+query+"&number=0", "", http.StatusBadRequest)
	request(http.MethodGet, base+"/references?number=1", "", http.StatusBadRequest)
	_, err = store.pool.Exec(ctx, `INSERT INTO users (id, display_name) VALUES ('participant', 'Participant'), ('other', 'Other')`)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `UPDATE issues SET created_by = 'participant' WHERE organization_id = $1 AND id = $2`, h.organizationID, second.ID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `INSERT INTO labels (organization_id, id, repository, name, color) VALUES
		($1, 'label-one', $2, 'bug', 'd73a4a'), ($1, 'other-label', 'team/other', 'other', 'ffffff')`, h.organizationID, repository)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `INSERT INTO issue_labels (organization_id, issue_id, label_id) VALUES
		($1, $2, 'label-one'), ($1, $3, 'other-label')`, h.organizationID, first.ID, other.ID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `INSERT INTO issue_assignees (organization_id, issue_id, user_id) VALUES
		($1, $2, 'participant'), ($1, $3, 'other')`, h.organizationID, first.ID, other.ID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `INSERT INTO milestones (organization_id, id, repository, title) VALUES
		($1, 'release-one', $2, 'Release one')`, h.organizationID, repository)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `UPDATE issues SET milestone_id = 'release-one' WHERE organization_id = $1 AND id = $2`, h.organizationID, first.ID)
	lockMust(t, err)

	detail := fmt.Sprintf("%s/%d", base, first.Number)
	request(http.MethodPost, detail+"/comments"+query, `{"body":"Comment"}`, http.StatusCreated)
	assertMetadata := func(got issueResponse) {
		t.Helper()
		if got.Number != first.Number || got.Comments != 1 || got.MilestoneID != "release-one" ||
			len(got.Labels) != 1 || got.Labels[0].Name != "bug" ||
			len(got.Assignees) != 1 || got.Assignees[0].UserID != "participant" {
			t.Fatalf("expected complete first issue, got %+v", got)
		}
	}
	assertMetadata(decode(request(http.MethodGet, detail+query, "", http.StatusOK)))
	request(http.MethodPost, detail+"/close"+query, `{"state_reason":"completed"}`, http.StatusBadRequest)
	closed := decode(request(http.MethodPost, detail+"/close"+query, `{"reason":"not_planned"}`, http.StatusOK))
	assertMetadata(closed)
	if closed.State != "closed" || closed.StateReason != "not_planned" || closed.ClosedAt == "" || closed.ClosedBy != h.userID {
		t.Fatalf("incorrect closure metadata: %+v", closed)
	}
	if got := decode(request(http.MethodGet, detail+query, "", http.StatusOK)); got.StateReason != closed.StateReason {
		t.Fatalf("close was not persisted: %+v", got)
	}

	list := func(params string, limit, offset, total, open, closed int, numbers ...int) []issueResponse {
		t.Helper()
		var page struct {
			Items         []issueResponse  `json:"items"`
			Total         int              `json:"total"`
			OpenTotal     int              `json:"open_total"`
			ClosedTotal   int              `json:"closed_total"`
			Limit         int              `json:"limit"`
			Offset        int              `json:"offset"`
			FilterOptions *optionsResponse `json:"filter_options"`
		}
		body := request(http.MethodGet, base+query+params, "", http.StatusOK)
		lockMust(t, json.Unmarshal(body, &page))
		if page.Total != total || page.OpenTotal != open || page.ClosedTotal != closed ||
			page.Limit != limit || page.Offset != offset || page.Items == nil || len(page.Items) != len(numbers) {
			t.Fatalf("unexpected page for %s: %s", params, body)
		}
		for i, number := range numbers {
			if page.Items[i].Number != number {
				t.Fatalf("unexpected issue order for %s: %s", params, body)
			}
		}
		if strings.Contains(params, "&include_filter_options=true") {
			want := &optionsResponse{[]string{h.userID, "participant"}, []string{"bug"}, []string{"participant"}, []string{"release-one"}}
			if !reflect.DeepEqual(page.FilterOptions, want) {
				t.Fatalf("filter options must include values from all repository pages and states: %s", body)
			}
		} else if page.FilterOptions != nil {
			t.Fatalf("filter options were returned without being requested: %s", body)
		}
		return page.Items
	}
	list("&state=open&limit=1&offset=1&include_filter_options=true", 1, 1, 1, 1, 1)
	list("&sort=created&direction=asc&limit=1&offset=1", 1, 1, 2, 1, 1, second.Number)
	list("&sort=created&direction=desc", 20, 0, 2, 1, 1, second.Number, first.Number)
	assertMetadata(list("&sort=comments&direction=desc", 20, 0, 2, 1, 1, first.Number, second.Number)[0])
	list("&sort=updated", 20, 0, 2, 1, 1, first.Number, second.Number)
	list("&q=%23"+fmt.Sprint(second.Number), 20, 0, 1, 1, 0, second.Number)
	list("&q=first", 20, 0, 1, 0, 1, first.Number)
	list("&since=2100-01-01T00:00:00Z", 20, 0, 0, 0, 0)
	list("&created_by=participant", 20, 0, 1, 1, 0, second.Number)
	list("&assignee=participant", 20, 0, 1, 0, 1, first.Number)
	list("&labels=bug", 20, 0, 1, 0, 1, first.Number)
	list("&milestone=release-one", 20, 0, 1, 0, 1, first.Number)
	list("&state=open&labels=bug", 20, 0, 0, 0, 1)
	for _, parameter := range []string{"state=all", "sort=unknown", "direction=unknown", "limit=0", "offset=-1", "since=unknown", "include_filter_options=unknown"} {
		request(http.MethodGet, base+query+"&"+parameter, "", http.StatusBadRequest)
	}
	request(http.MethodGet, base+"?include_filter_options=true", "", http.StatusBadRequest)
	request(http.MethodPost, detail+"/close"+query, `{"reason":"completed"}`, http.StatusConflict)
	for _, route := range []string{detail + "/reopen" + query, detail + query} {
		method := http.MethodGet
		if route != detail+query {
			method = http.MethodPost
		}
		got := decode(request(method, route, "", http.StatusOK))
		assertMetadata(got)
		if got.State != "open" || got.StateReason != "" || got.ClosedAt != "" || got.ClosedBy != "" {
			t.Fatalf("reopen did not clear closure metadata: %+v", got)
		}
	}
	request(http.MethodPost, detail+"/reopen"+query, "", http.StatusConflict)
	list("&state=closed", 20, 0, 0, 2, 0)
}

func TestIssueCreateMetadata(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	h := newLockHTTP(t, &lockFixture{ctx: ctx, store: store}, 0, "team/repo", "team/other")
	h.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, AllowedOrigin: lockHTTPOrigin,
		IssueRepo: NewIssueRepository(store),
	})
	_, err = store.pool.Exec(ctx, `INSERT INTO labels (organization_id, id, repository, name, color) VALUES
		($1, 'local-label', 'team/repo', 'Ready', 'd73a4a'), ($1, 'other-label', 'team/other', 'Other', 'ffffff')`, h.organizationID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `INSERT INTO milestones (organization_id, id, repository, title, state, closed_at) VALUES
		($1, 'release', 'team/repo', 'Release', 'open', NULL),
		($1, 'closed', 'team/repo', 'Closed', 'closed', now()),
		($1, 'other-milestone', 'team/other', 'Other', 'open', NULL)`, h.organizationID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `INSERT INTO users (id, display_name) VALUES ('not-a-member', 'Not a member')`)
	lockMust(t, err)
	base := "/api/v1/organizations/" + h.organizationID + "/issues"
	create := func(fields string, status int) issues.Issue {
		t.Helper()
		response := h.do(ctx, http.MethodPost, base, `{"repository":"team/repo","title":"Metadata"`+fields+`}`)
		if response.Code != status {
			t.Fatalf("create with %s returned %d, want %d: %s", fields, response.Code, status, response.Body)
		}
		var issue issues.Issue
		if status == http.StatusCreated {
			lockMust(t, json.Unmarshal(response.Body.Bytes(), &issue))
		}
		return issue
	}
	for _, fields := range []string{
		`,"label_ids":["local-label","other-label"]`, `,"assignees":["not-a-member"]`,
		`,"milestone_id":"other-milestone"`, `,"milestone_id":"closed"`, `,"issue_type":"invalid"`,
	} {
		create(fields, http.StatusUnprocessableEntity)
	}
	valid := fmt.Sprintf(`,"assignees":[%q],"label_ids":["local-label"],"milestone_id":"release","issue_type":"bug"`, h.userID)
	created := create(valid, http.StatusCreated)
	if created.Number != 1 || created.Type != "bug" || created.MilestoneTitle != "Release" || len(created.Labels) != 1 ||
		created.Labels[0].Name != "Ready" || !reflect.DeepEqual(created.Assignees, []issues.Assignee{{UserID: h.userID, DisplayName: h.userID}}) {
		t.Fatalf("expected persisted metadata on first issue: %+v", created)
	}
	_, err = store.pool.Exec(ctx, `UPDATE organization_memberships SET role = 'member' WHERE organization_id = $1 AND user_id = $2`, h.organizationID, h.userID)
	lockMust(t, err)
	create(valid, http.StatusForbidden)
	if issue := create("", http.StatusCreated); issue.Number != 2 || len(issue.Labels) != 0 || len(issue.Assignees) != 0 || issue.MilestoneID != "" || issue.Type != "" {
		t.Fatalf("expected an issue without metadata: %+v", issue)
	}
}

func TestIssueAttachmentLifecycle(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	fx := &lockFixture{ctx: ctx, store: store}
	uploader := newLockHTTP(t, fx, 0, "team/repo", "team/other")
	reader := newLockHTTP(t, fx, 0, "team/repo")
	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, AllowedOrigin: lockHTTPOrigin,
		IssueRepo: NewIssueRepository(store),
	})
	uploader.handler, reader.handler = handler, handler
	_, err = store.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role, status)
		VALUES ($1, $2, 'member', 'active')`, uploader.organizationID, reader.userID)
	lockMust(t, err)
	base := "/api/v1/organizations/" + uploader.organizationID
	request := func(session *lockHTTP, method, route, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		response := session.do(ctx, method, route, body)
		if response.Code != status {
			t.Fatalf("%s %s returned %d, want %d: %s", method, route, response.Code, status, response.Body)
		}
		return response
	}
	request(uploader, http.MethodPost, base+"/issue-attachments?repository=team%2Frepo&filename=large.png", strings.Repeat("x", (10<<20)+1), http.StatusRequestEntityTooLarge)
	const content = "Attachment saved from the Issue draft.\n"
	upload := func() (id, route string) {
		t.Helper()
		response := request(uploader, http.MethodPost, base+"/issue-attachments?repository=team%2Frepo&filename=notes.txt", content, http.StatusCreated)
		var file struct{ ID, URL string }
		lockMust(t, json.Unmarshal(response.Body.Bytes(), &file))
		return file.ID, file.URL
	}
	id, route := upload()
	expiredID, expiredRoute := upload()
	_, err = store.pool.Exec(ctx, `UPDATE issue_attachments SET expires_at = now() WHERE organization_id = $1 AND id = $2`, uploader.organizationID, expiredID)
	lockMust(t, err)
	request(uploader, http.MethodGet, route, "", http.StatusOK)
	request(uploader, http.MethodGet, expiredRoute, "", http.StatusNotFound)
	request(reader, http.MethodGet, route, "", http.StatusNotFound)
	request(reader, http.MethodGet, "/api/v1/organizations/"+reader.organizationID+"/issue-attachments/"+id, "", http.StatusNotFound)
	create := func(session *lockHTTP, repository, body string, ids []string, status int) *httptest.ResponseRecorder {
		t.Helper()
		data, err := json.Marshal(map[string]any{"repository": repository, "title": "Attachments", "body": body, "attachment_ids": ids})
		lockMust(t, err)
		return request(session, http.MethodPost, base+"/issues", string(data), status)
	}
	body := "[notes](" + route + ")"
	create(reader, "team/repo", body, []string{id}, http.StatusUnprocessableEntity)
	create(uploader, "team/other", body, []string{id}, http.StatusUnprocessableEntity)
	create(uploader, "team/repo", body+"\n[Expired]("+expiredRoute+")", []string{id, expiredID}, http.StatusUnprocessableEntity)
	request(reader, http.MethodGet, route, "", http.StatusNotFound)

	created := create(uploader, "team/repo", body, []string{id}, http.StatusCreated)
	var issue issues.Issue
	lockMust(t, json.Unmarshal(created.Body.Bytes(), &issue))
	if issue.Number != 1 {
		t.Fatalf("failed attachment binding must roll back issue creation, got issue #%d", issue.Number)
	}
	download := request(reader, http.MethodGet, route, "", http.StatusOK)
	if download.Body.String() != content || download.Header().Get("Content-Disposition") != "attachment; filename=notes.txt" {
		t.Fatalf("expected published bytes and download disposition, got %q (%v)", download.Body, download.Header())
	}
	create(uploader, "team/repo", body, []string{id}, http.StatusUnprocessableEntity)
}
