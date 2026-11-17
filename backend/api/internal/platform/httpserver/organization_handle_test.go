package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

// handleIdentity models the production resolver: it maps the organization handle in the
// URL (an id or a slug) to the canonical organization id of one of the caller's own
// memberships, and treats every other handle exactly like an unknown organization.
type handleIdentity struct{ canonical map[string]string }

func (h handleIdentity) ResolvePrincipal(_ *http.Request, handle string) (Principal, error) {
	id, ok := h.canonical[handle]
	if !ok {
		return Principal{}, identity.ErrUnauthenticated
	}
	return Principal{UserID: "test-user", OrganizationID: id, Role: "member"}, nil
}

func newHandleHandler(repository *memoryRepository, resolver identity.PrincipalResolver) http.Handler {
	return NewHandlerWithDependencies(DeliveryDependencies{Repository: repository, Identity: resolver, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test"})
}

func TestOrganizationHandleResolvesToCanonicalOrganization(t *testing.T) {
	repository := newMemoryRepository()
	handler := newHandleHandler(repository, handleIdentity{canonical: map[string]string{"acme": "org-0123", "org-0123": "org-0123"}})

	create := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/acme/changesets", bytes.NewBufferString(`{"repository":"org/repo","title":"Created through the slug"}`))
	addValidCSRFCookies(create)
	created := httptest.NewRecorder()
	handler.ServeHTTP(created, create)
	if created.Code != http.StatusCreated {
		t.Fatalf("create through slug: status=%d body=%s", created.Code, created.Body.String())
	}
	var stored storedChangesetResponse
	if err := json.Unmarshal(created.Body.Bytes(), &stored); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.Get(context.Background(), "org-0123", stored.Changeset.ID); err != nil {
		t.Fatalf("changeset must be stored under the canonical organization id: %v", err)
	}
	if _, err := repository.Get(context.Background(), "acme", stored.Changeset.ID); !errors.Is(err, delivery.ErrNotFound) {
		t.Fatalf("the slug must never be used as a tenant key, got err=%v", err)
	}

	for _, handle := range []string{"acme", "org-0123"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/organizations/"+handle+"/changesets", nil))
		if response.Code != http.StatusOK {
			t.Fatalf("list through %q: status=%d body=%s", handle, response.Code, response.Body.String())
		}
		var page changesetListResponse
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 1 {
			t.Fatalf("list through %q: items=%d, want 1", handle, len(page.Items))
		}
	}
}

func TestUnknownAndNonMemberOrganizationHandlesAreIndistinguishable(t *testing.T) {
	handler := newHandleHandler(newMemoryRepository(), handleIdentity{canonical: map[string]string{"acme": "org-0123"}})
	get := func(handle string) (int, string) {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/organizations/"+handle+"/changesets", nil))
		return response.Code, response.Body.String()
	}
	// "rival" stands for a real organization the caller does not belong to: the resolver
	// cannot tell it apart from "no-such-org", and neither may the HTTP layer.
	nonMemberStatus, nonMemberBody := get("rival")
	unknownStatus, unknownBody := get("no-such-org")
	if nonMemberStatus != http.StatusUnauthorized || unknownStatus != nonMemberStatus || unknownBody != nonMemberBody {
		t.Fatalf("non-member (%d %q) and unknown (%d %q) handles must produce the same 401", nonMemberStatus, nonMemberBody, unknownStatus, unknownBody)
	}
}

type emptyOrganizationIdentity struct{}

func (emptyOrganizationIdentity) ResolvePrincipal(*http.Request, string) (Principal, error) {
	return Principal{UserID: "test-user", Role: "member"}, nil
}

func TestResolverMustReturnACanonicalOrganizationID(t *testing.T) {
	handler := newHandleHandler(newMemoryRepository(), emptyOrganizationIdentity{})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/organizations/acme/changesets", nil))
	if response.Code != http.StatusForbidden {
		t.Fatalf("principal without an organization id: status=%d, want 403", response.Code)
	}
}

type fixedPrincipalIdentity struct{ principal Principal }

func (f fixedPrincipalIdentity) ResolvePrincipal(*http.Request, string) (Principal, error) {
	return f.principal, nil
}

// The resolver is the authority for handle -> organization, but the handler still checks that the
// organization it returned is the one the URL names (the canonical id exactly, or its slug ignoring
// ASCII case, like the resolver). A resolver bug, a stale cache or a wrong join must end in a 403,
// never in another organization's data.
func TestPrincipalMustBelongToTheOrganizationTheURLNames(t *testing.T) {
	resolved := Principal{UserID: "test-user", OrganizationID: "org-9999", OrganizationSlug: "other", Role: "member"}
	kelvin := Principal{UserID: "test-user", OrganizationID: "org-1", OrganizationSlug: "kelvin", Role: "member"}
	for _, test := range []struct {
		name      string
		principal Principal
		handle    string
		want      int
	}{
		{"another organization than the id or slug in the URL", resolved, "acme", http.StatusForbidden},
		{"an id that differs only in case is another handle", resolved, "ORG-9999", http.StatusForbidden},
		{"the canonical id", resolved, "org-9999", http.StatusOK},
		{"the slug", resolved, "other", http.StatusOK},
		{"the slug in other case", resolved, "OTHER", http.StatusOK},
		{"a non-ASCII case fold is not the slug (the resolver folds ASCII only)", kelvin, "Kelvin", http.StatusForbidden},
		{"no slug on the principal never matches a slug-looking handle", Principal{UserID: "test-user", OrganizationID: "org-9999", Role: "member"}, "other", http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := newHandleHandler(newMemoryRepository(), fixedPrincipalIdentity{principal: test.principal})
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/organizations/"+test.handle+"/changesets", nil))
			if response.Code != test.want {
				t.Fatalf("handle %q resolved to %+v: status=%d body=%s, want %d", test.handle, test.principal, response.Code, response.Body.String(), test.want)
			}
		})
	}
}
