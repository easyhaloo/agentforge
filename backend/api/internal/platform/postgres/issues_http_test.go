package postgres

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"

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
		Identity: store, CSRF: store, AllowedOrigin: lockHTTPOrigin,
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
	request(http.MethodPost, detail+"/comments?issue_id="+url.QueryEscape(first.ID), `{"body":"Comment"}`, http.StatusCreated)
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
