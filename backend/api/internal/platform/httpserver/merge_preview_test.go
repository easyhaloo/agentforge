package httpserver

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

type previewGit struct{ lifecycleGit }

func (previewGit) SupportsMergePreview(context.Context) bool { return true }
func (previewGit) PreviewMerge(_ context.Context, org, slug string, req delivery.MergeRequest) (delivery.MergePreview, error) {
	if org != "a" || slug != "team/repo" || req.Target != "main" || len(req.Sources) != 1 || req.Sources[0] != "topic" {
		return delivery.MergePreview{}, delivery.ErrRepositoryInvalid
	}
	return delivery.MergePreview{Status: "clean"}, nil
}

func TestMergePreviewHTTP(t *testing.T) {
	catalog := &lifecycleCatalog{items: []delivery.RepositoryMetadata{{OrganizationID: "a", Slug: "team/repo"}}}
	for _, tc := range []struct {
		name, method, org, role string
		csrf, capable           bool
		status                  int
		body                    string
	}{
		{"member preview", "POST", "a", "member", true, true, 200, `"status":"clean"`},
		{"other catalog", "POST", "b", "member", true, true, 404, "Unknown repository"},
		{"read-only member", "POST", "a", "viewer", true, true, 403, "Insufficient permissions"},
		{"missing origin", "POST", "a", "member", false, true, 403, "Origin rejected"},
		{"unavailable provider", "POST", "a", "member", true, false, 503, "Merge preview unavailable"},
		{"capabilities", "GET", "a", "viewer", false, true, 200, `"orderedMergePreview":true`},
		{"unsupported", "GET", "a", "member", false, false, 200, `"orderedMergePreview":false`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var git delivery.GitProvider = lifecycleGit{}
			if tc.capable {
				git = previewGit{}
			}
			h := NewHandlerWithDependencies(DeliveryDependencies{Repository: newMemoryRepository(), Git: git, Catalog: catalog, Identity: fixedIdentity{role: tc.role}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test"})
			path := "/api/v1/organizations/" + tc.org + "/merge-preview"
			if tc.method == "GET" {
				path += "/capabilities"
			}
			req := httptest.NewRequest(tc.method, path, strings.NewReader(`{"repository":"team/repo","target":"main","sources":["topic"]}`))
			if tc.csrf {
				addValidCSRFCookies(req)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.body) {
				t.Fatalf("response %d %s", w.Code, w.Body)
			}
		})
	}
}
