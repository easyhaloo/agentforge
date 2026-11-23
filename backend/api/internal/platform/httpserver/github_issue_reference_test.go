package httpserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type githubIssueRoundTrip func(*http.Request) (*http.Response, error)

func (f githubIssueRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGitHubIssueReference(t *testing.T) {
	for _, tc := range []struct {
		name, body     string
		upstream, want int
		reference      githubIssueReference
	}{
		{"issue", `{"number":42,"title":"Public issue","state":"open"}`, 200, 200, githubIssueReference{"issues", "Public issue", "open"}},
		{"closed pull", `{"number":42,"title":"Closed PR","state":"closed","pull_request":{}}`, 200, 200, githubIssueReference{"pull", "Closed PR", "closed"}},
		{"merged pull", `{"number":42,"title":"Merged PR","state":"closed","pull_request":{"merged_at":"2026-11-22T03:33:10Z"}}`, 200, 200, githubIssueReference{"pull", "Merged PR", "merged"}},
		{"private or missing", "", 404, 404, githubIssueReference{}},
		{"limited", "", 429, 503, githubIssueReference{}},
		{"wrong number", `{"number":43}`, 200, 503, githubIssueReference{}},
		{"redirect", "", 301, 503, githubIssueReference{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := *githubIssueClient
			client.Transport = githubIssueRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.Method != http.MethodGet || r.URL.String() != "https://api.github.com/repos/octo/demo/issues/42" || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
					t.Fatal("lookup must use only the public GitHub endpoint without credentials")
				}
				return &http.Response{StatusCode: tc.upstream, Header: http.Header{"Location": {"https://example.test/"}}, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			if reference, status := githubIssueReferenceFor(t.Context(), &client, "octo/demo", 42); reference != tc.reference || status != tc.want {
				t.Fatalf("got %+v, %d; want %+v, %d", reference, status, tc.reference, tc.want)
			}
		})
	}
}

func TestRejectInvalidGitHubIssueReference(t *testing.T) {
	handler := NewHandlerWithDependencies(DeliveryDependencies{Identity: fixedIdentity{role: "member"}})
	for _, query := range []string{"repository=octo/demo&number=0", "repository=octo/demo&number=2147483648", "repository=octo/..&number=1", "repository=octo/demo%2F..&number=1", "repository=https%3A%2F%2Fexample.test&number=1"} {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-a/issues/github-reference?"+query, nil))
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("%s got %d, want 400", query, recorder.Code)
		}
	}
}

func TestGitHubPullReferences(t *testing.T) {
	for _, tc := range []struct {
		name, query, path, body  string
		upstream, status, number int
	}{
		{"exact PR", "42", "/repos/octo/demo/issues/42", `{"number":42,"title":"Public PR","state":"open","pull_request":{}}`, 200, 200, 42},
		{"exact issue", "42", "/repos/octo/demo/issues/42", `{"number":42,"title":"Issue","state":"open"}`, 200, 200, 0},
		{"missing", "42", "/repos/octo/demo/issues/42", "", 404, 200, 0},
		{"keyword", "docs", "/search/issues", `{"items":[
			{"number":8,"title":"Wrong repo","repository_url":"https://api.github.com/repos/octo/other","pull_request":{}},
			{"number":9,"title":"Issue","repository_url":"https://api.github.com/repos/octo/demo"},
			{"number":42,"title":"Public PR","repository_url":"https://api.github.com/repos/Octo/demo","pull_request":{}}
		]}`, 200, 200, 42},
		{"rate limit", "docs", "/search/issues", "", 429, 503, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := *githubIssueClient
			client.Transport = githubIssueRoundTrip(func(r *http.Request) (*http.Response, error) {
				if r.Method != http.MethodGet || r.URL.Host != "api.github.com" || r.URL.Path != tc.path || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
					t.Fatalf("unexpected upstream request: %s", r.URL)
				}
				if tc.path == "/search/issues" && (r.URL.Query().Get("q") != `repo:octo/demo is:pr in:title "docs"` || r.URL.Query().Get("per_page") != "6") {
					t.Fatalf("search must be scoped to public PR titles: %s", r.URL.RawQuery)
				}
				return &http.Response{StatusCode: tc.upstream, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			items, status := githubPullReferencesFor(t.Context(), &client, "octo/demo", tc.query)
			if status != tc.status || tc.number == 0 && len(items) != 0 || tc.number != 0 && (len(items) != 1 || items[0].Number != tc.number || items[0].Title != "Public PR") {
				t.Fatalf("got %+v (%d), want PR number %d (%d)", items, status, tc.number, tc.status)
			}
		})
	}
}
