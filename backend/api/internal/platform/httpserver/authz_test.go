package httpserver

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

// TestCrossTenantChangesetAccessDenied verifies that users from organization A
// cannot access changesets from organization B.
func TestCrossTenantChangesetAccessDenied(t *testing.T) {
	// The principal resolver should return ErrUnauthenticated when a user
	// tries to access an organization they don't belong to
	resolver := &testCrossTenantResolver{
		allowedOrg: "org-a",
	}

	deps := DeliveryDependencies{
		Identity: resolver,
	}

	handler := newDeliveryHandler(deps)

	// User from org-a tries to access org-b (resolver will return ErrUnauthenticated)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-b/changesets", nil)
	req.SetPathValue("organizationID", "org-b")
	req.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: "session-org-a"})

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("cross-tenant access returned status %d, want 401", rec.Code)
	}
}

// TestSuspendedMemberDenied verifies that suspended members cannot access organization resources.
// ResolvePrincipal implementation checks membership status in the database and returns
// ErrUnauthenticated for suspended members.
func TestSuspendedMemberDenied(t *testing.T) {
	// Simulates a resolver that rejects all requests (like a suspended member)
	resolver := &testCrossTenantResolver{
		rejectAll: true,
	}

	deps := DeliveryDependencies{
		Identity: resolver,
	}

	handler := newDeliveryHandler(deps)

	// Suspended member tries to list changesets
	req := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-a/changesets", nil)
	req.SetPathValue("organizationID", "org-a")
	req.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: "session-suspended"})

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("suspended member access returned status %d, want 401", rec.Code)
	}
}

// TestViewerCannotInviteMembers verifies that viewer role cannot create invitations.
func TestViewerCannotInviteMembers(t *testing.T) {
	// Viewer principal
	resolver := &testCrossTenantResolver{
		allowedOrg: "org-a",
		role:       "viewer",
	}

	deps := DeliveryDependencies{
		Identity: resolver,
		CSRF:     &testCSRFValidator{},
	}

	handler := newDeliveryHandler(deps)

	// Viewer tries to create an invitation
	body := bytes.NewBufferString(`{"email":"new@example.test","role":"member"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/invitations", body)
	req.SetPathValue("organizationID", "org-a")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(identity.CSRFHeaderName, "csrf-token")
	req.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: "session-viewer"})
	req.AddCookie(&http.Cookie{Name: identity.CSRFCookieName, Value: "csrf-token"})

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("viewer invitation creation returned status %d, want 403", rec.Code)
	}
}

// TestCrossTenantMemberListIsolation verifies that member listing is isolated by organization.
func TestCrossTenantMemberListIsolation(t *testing.T) {
	// User only has access to org-a
	resolver := &testCrossTenantResolver{
		allowedOrg: "org-a",
		role:       "admin",
	}

	deps := DeliveryDependencies{
		Identity: resolver,
	}

	handler := newDeliveryHandler(deps)

	// User from org-a requests members from org-b (should fail authentication)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-b/members", nil)
	req.SetPathValue("organizationID", "org-b")
	req.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: "session-org-a"})

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("cross-tenant member list returned status %d, want 401", rec.Code)
	}
}

// Test helper implementations

type testCrossTenantResolver struct {
	allowedOrg string
	role       string
	rejectAll  bool
}

func (t *testCrossTenantResolver) ResolvePrincipal(r *http.Request, organizationHandle string) (identity.Principal, error) {
	if t.rejectAll {
		return identity.Principal{}, identity.ErrUnauthenticated
	}

	if organizationHandle != t.allowedOrg {
		return identity.Principal{}, identity.ErrUnauthenticated
	}

	role := t.role
	if role == "" {
		role = "member"
	}

	return identity.Principal{
		UserID:         "test-user",
		OrganizationID: t.allowedOrg,
		Role:           role,
	}, nil
}

type testCSRFValidator struct{}

func (t *testCSRFValidator) ValidateCSRF(ctx context.Context, sessionToken, csrfToken string) error {
	return nil
}
