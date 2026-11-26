package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

// Role matrix for the lifecycle endpoints (SPEC section 5): Owner allowed,
// Admin forbidden on the owner-only operations, non-members 404 via the
// shared principal gate. The store is nil on purpose: the authorization
// happens before the nil-store "unavailable" response would.
func TestLifecycleRoleMatrix(t *testing.T) {
	tests := []struct {
		name  string
		role  string
		setup func(deps *DeliveryDependencies)
		call  func(handler http.Handler) *httptest.ResponseRecorder
		want  int
	}{
		{
			name: "suspend as owner reaches the store (503 without one)",
			role: "owner",
			call: func(handler http.Handler) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/suspend", nil)
				addValidCSRFCookies(request)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				return response
			},
			want: http.StatusServiceUnavailable,
		},
		{
			name: "suspend as admin is forbidden before touching the store",
			role: "admin",
			call: func(handler http.Handler) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/suspend", nil)
				addValidCSRFCookies(request)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				return response
			},
			want: http.StatusForbidden,
		},
		{
			name: "resume as admin is forbidden (owner-only)",
			role: "admin",
			call: func(handler http.Handler) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/resume", nil)
				addValidCSRFCookies(request)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				return response
			},
			want: http.StatusForbidden,
		},
		{
			name: "resume as owner is allowed while organization is suspended",
			role: "owner",
			setup: func(deps *DeliveryDependencies) {
				deps.Identity = statusIdentity{user: "u1", role: "owner", status: "suspended"}
			},
			call: func(handler http.Handler) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/resume", nil)
				addValidCSRFCookies(request)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				return response
			},
			want: http.StatusServiceUnavailable, // whitelist passes the 423 gate, fails on the nil store
		},
		{
			name: "deletion cancel as owner is allowed while pending deletion",
			role: "owner",
			setup: func(deps *DeliveryDependencies) {
				deps.Identity = statusIdentity{user: "u1", role: "owner", status: "pending_deletion"}
			},
			call: func(handler http.Handler) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodDelete, "/api/v1/organizations/org-a/deletion", nil)
				addValidCSRFCookies(request)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				return response
			},
			want: http.StatusServiceUnavailable,
		},
		{
			name: "transfer as member is forbidden",
			role: "member",
			call: func(handler http.Handler) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/transfer-ownership", nil)
				addValidCSRFCookies(request)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				return response
			},
			want: http.StatusForbidden,
		},
		{
			name: "non-member handle is refused before the store",
			role: "member",
			setup: func(deps *DeliveryDependencies) {
				deps.Identity = foreignIdentity{user: "u1", memberOf: "org-b"}
			},
			call: func(handler http.Handler) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/suspend", nil)
				addValidCSRFCookies(request)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				return response
			},
			want: http.StatusUnauthorized,
		},
		{
			name: "anonymous viewer write on suspend is forbidden",
			role: "viewer",
			call: func(handler http.Handler) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/suspend", nil)
				addValidCSRFCookies(request)
				response := httptest.NewRecorder()
				handler.ServeHTTP(response, request)
				return response
			},
			want: http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			deps := DeliveryDependencies{
				Identity:      statusIdentity{user: "u1", role: tt.role, status: "active"},
				CSRF:          allowCSRF{},
				AllowedOrigin: "https://app.example.test",
			}
			if tt.setup != nil {
				tt.setup(&deps)
			}
			handler := NewHandlerWithDependencies(deps)
			response := tt.call(handler)
			if response.Code != tt.want {
				t.Fatalf("%s: %d %s, want %d", tt.name, response.Code, response.Body.String(), tt.want)
			}
		})
	}
}

// foreignIdentity resolves only when the requested handle matches memberOf,
// simulating a caller whose membership belongs to another organization.
type foreignIdentity struct {
	user, memberOf string
}

func (f foreignIdentity) ResolvePrincipal(_ *http.Request, org string) (Principal, error) {
	if org != f.memberOf {
		return Principal{}, identity.ErrUnauthenticated
	}
	return Principal{UserID: f.user, OrganizationID: org, Role: "owner", OrganizationStatus: "active"}, nil
}
