package httpserver

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestFetchIssueGitHubSource(t *testing.T) {
	client := *githubIssueClient
	client.Transport = githubIssueRoundTrip(func(req *http.Request) (*http.Response, error) {
		if req.Method != "GET" || req.URL.Host != "api.github.com" || req.Header.Get("Authorization") != "" {
			t.Fatalf("unexpected GitHub request: %s", req.URL)
		}
		var body string
		header := make(http.Header)
		switch req.URL.Path {
		case "/repos/octo/demo/issues/8":
			body = `{"number":8,"title":"Public issue","state":"open"}`
		case "/repos/octo/demo/issues/8/timeline":
			if req.URL.Query().Get("page") == "1" {
				header.Set("Link", `<https://example.test/untrusted>; rel="next"`)
				body = `[{"event":"labeled"}]`
				break
			}
			if req.URL.Query().Get("page") != "2" {
				t.Fatalf("unexpected timeline page: %s", req.URL)
			}
			body = `[
				{"event":"labeled"},
				{"event":"cross-referenced","created_at":"2026-11-17T04:03:18Z","actor":{"login":"octo"},"source":{"issue":{"html_url":"https://github.com/octo/demo/pull/9","title":"Linked PR"}}},
				{"event":"cross-referenced","created_at":"2026-11-17T04:03:18Z","source":{"issue":{"html_url":"https://github.com@example.test/octo/demo/pull/9"}}}
			]`
		default:
			t.Fatalf("unexpected request path: %s", req.URL.Path)
		}
		return &http.Response{StatusCode: 200, Header: header, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	source, status := fetchIssueGitHubSource(t.Context(), &client, "octo/demo", 8)
	if status != 200 || source.URL != "https://github.com/octo/demo/issues/8" || len(source.References) != 1 || source.References[0].Number != 9 || source.References[0].Actor != "octo" {
		t.Fatalf("expected the canonical issue and one trusted cross-reference, got %d, %+v", status, source)
	}
}
