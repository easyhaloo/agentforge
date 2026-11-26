package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

// statusIdentity resolves like the real Store but reports the organization's
// lifecycle status, as the lifecycle migration introduces it.
type statusIdentity struct {
	user, role, status string
}

func (i statusIdentity) ResolvePrincipal(_ *http.Request, org string) (Principal, error) {
	return Principal{UserID: i.user, OrganizationID: org, Role: i.role, OrganizationStatus: i.status}, nil
}

func TestSuspendedOrganizationWritesReturn423(t *testing.T) {
	tests := []struct {
		name   string
		status string
	}{
		{name: "suspended organization", status: "suspended"},
		{name: "pending deletion organization", status: "pending_deletion"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			deps := DeliveryDependencies{
				Repository:    newMemoryRepository(),
				Catalog:       &lifecycleCatalog{},
				Identity:      statusIdentity{user: "author-1", role: "owner", status: tt.status},
				CSRF:          allowCSRF{},
				AllowedOrigin: "https://app.example.test",
			}
			handler := NewHandlerWithDependencies(deps)
			call := func(method, path, body string) *httptest.ResponseRecorder {
				request := httptest.NewRequest(method, path, nil)
				if method != "GET" {
					addValidCSRFCookies(request)
				}
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				return response
			}
			base := "/api/v1/organizations/org-a"

			// Reads stay allowed while suspended.
			if response := call(http.MethodGet, base+"/changesets", ""); response.Code != http.StatusOK {
				t.Errorf("read while locked: %d, want 200", response.Code)
			}
			// Changeset write.
			if response := call(http.MethodPost, base+"/changesets", `{"repository":"team/repo","title":"x"}`); response.Code != http.StatusLocked {
				t.Errorf("changeset write while locked: %d, want 423", response.Code)
			}
			// Issue write.
			if response := call(http.MethodPost, base+"/issues", `{"repository":"team/repo","title":"x"}`); response.Code != http.StatusLocked {
				t.Errorf("issue write while locked: %d, want 423", response.Code)
			}
			// Pipeline write.
			if response := call(http.MethodPost, base+"/pipelines", `{}`); response.Code != http.StatusLocked {
				t.Errorf("pipeline write while locked: %d, want 423", response.Code)
			}
			// Member management write.
			if response := call(http.MethodPatch, base+"/members/user-2", `{"role":"admin"}`); response.Code != http.StatusLocked {
				t.Errorf("membership write while locked: %d, want 423", response.Code)
			}
			// Repository registration.
			if response := call(http.MethodPost, base+"/repositories", `{"slug":"team/repo"}`); response.Code != http.StatusLocked {
				t.Errorf("repository write while locked: %d, want 423", response.Code)
			}
		})
	}
}

func TestActiveOrganizationWritesUnaffected(t *testing.T) {
	deps := DeliveryDependencies{
		Repository:    newMemoryRepository(),
		Catalog:       &lifecycleCatalog{},
		Identity:      statusIdentity{user: "author-1", role: "owner", status: "active"},
		CSRF:          allowCSRF{},
		AllowedOrigin: "https://app.example.test",
	}
	handler := NewHandlerWithDependencies(deps)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/repositories", nil)
	addValidCSRFCookies(request)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	// Without a body this fails validation (400) — anything but 423 proves the
	// lifecycle gate is open for active organizations.
	if response.Code == http.StatusLocked {
		t.Fatalf("active organization write returned 423: %s", response.Body.String())
	}
}

func TestLockedPrincipalKeepsViewerReads(t *testing.T) {
	deps := DeliveryDependencies{
		Repository:    newMemoryRepository(),
		Catalog:       &lifecycleCatalog{},
		Identity:      statusIdentity{user: "viewer-1", role: "viewer", status: "suspended"},
		CSRF:          allowCSRF{},
		AllowedOrigin: "https://app.example.test",
	}
	handler := NewHandlerWithDependencies(deps)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-a/changesets", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("viewer read while locked: %d, want 200", response.Code)
	}
	_ = identity.ErrOrganizationLocked // referenced so the import stays if helpers change
}
