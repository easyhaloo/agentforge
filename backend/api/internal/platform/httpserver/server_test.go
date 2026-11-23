package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func TestHealthEndpoints(t *testing.T) {
	handler := NewHandler()
	tests := []struct {
		path   string
		status int
		body   string
	}{
		{path: "/healthz", status: http.StatusOK, body: "{\"status\":\"ok\"}\n"},
		{path: "/readyz", status: http.StatusServiceUnavailable, body: "{\"status\":\"not_ready\"}\n"},
	}

	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
			if got := response.Body.String(); got != test.body {
				t.Fatalf("body = %q, want %q", got, test.body)
			}
			if got := response.Header().Get("Content-Type"); got != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json", got)
			}
		})
	}
}

type readinessLocker struct{}

func (readinessLocker) LockChangeset(context.Context, string, string) (func(), error) {
	return func() {}, nil
}

func TestReadinessRequiresAllDeliveryDependencies(t *testing.T) {
	handler := NewHandlerWithDependencies(DeliveryDependencies{
		Repository: newMemoryRepository(), Identity: fixedIdentity{role: "member"}, CSRF: allowCSRF{},
		AllowedOrigin: "https://app.example.test", Git: lifecycleGit{}, Evaluator: lifecycleEvaluator{},
		Evidence: lifecycleEvidence{}, Catalog: &lifecycleCatalog{}, Locker: readinessLocker{}, Reviewers: lifecycleReviewers{},
	})
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "{\"status\":\"ready\"}\n" {
		t.Fatalf("readiness response = %d %q, want ready", response.Code, response.Body.String())
	}

	handler = NewHandlerWithDependencies(DeliveryDependencies{Repository: newMemoryRepository(), Identity: fixedIdentity{role: "member"}, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test"})
	request = httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness without delivery adapters = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}

}

func TestOIDCRoutesFailClosedWhenProviderIsNotConfigured(t *testing.T) {
	handler := NewHandler()
	for _, path := range []string{"/auth/oidc/login", "/auth/oidc/callback", "/auth/invitations/accept"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s status=%d, want 503", path, response.Code)
		}
	}
}

type fakeOIDCHandler struct{ accepted bool }

func (f *fakeOIDCHandler) Login(http.ResponseWriter, *http.Request)    {}
func (f *fakeOIDCHandler) Callback(http.ResponseWriter, *http.Request) {}
func (f *fakeOIDCHandler) AcceptInvitation(w http.ResponseWriter, r *http.Request) {
	f.accepted = true
	http.Redirect(w, r, "/auth/oidc/login", http.StatusSeeOther)
}

func TestInvitationAcceptanceRouteDelegatesToOIDC(t *testing.T) {
	oidc := &fakeOIDCHandler{}
	handler := NewHandlerWithDependencies(DeliveryDependencies{SSO: map[string]identity.OIDCHandler{"oidc": oidc}, AllowedOrigin: "https://app.example.test"})
	request := httptest.NewRequest(http.MethodGet, "/auth/invitations/accept?token=opaque-invitation-token", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther || !oidc.accepted {
		t.Fatalf("invitation acceptance status=%d accepted=%v", response.Code, oidc.accepted)
	}
}

func TestSSOProviderDiscoveryAndInvitationChoice(t *testing.T) {
	legacy := &fakeOIDCHandler{}
	handler := NewHandlerWithDependencies(DeliveryDependencies{
		SSO: map[string]identity.OIDCHandler{"github": &fakeOIDCHandler{}, "oidc": legacy},
	})
	for _, tc := range []struct {
		method, path, body, location string
		status                       int
	}{
		{"GET", "/auth/providers", `{"providers":[{"id":"github","login_url":"/auth/github/login"},{"id":"oidc","login_url":"/auth/oidc/login"}]}` + "\n", "", 200},
		{"GET", "/auth/google/login", "", "", 503},
		{"HEAD", "/auth/github/callback", "", "", 405},
		{"GET", "/auth/invitations/accept?token=" + strings.Repeat("a", 43), "", "/login?invitation=1", 303},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, httptest.NewRequest(tc.method, tc.path, nil))
			if res.Code != tc.status || res.Header().Get("Location") != tc.location || (tc.body != "" && res.Body.String() != tc.body) {
				t.Fatalf("status=%d location=%q body=%q", res.Code, res.Header().Get("Location"), res.Body.String())
			}
			if tc.location != "" {
				cookies := res.Result().Cookies()
				if len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode || legacy.accepted {
					t.Fatal("named SSO did not bind the invitation to the browser and route to the chooser")
				}
			}
		})
	}
	res := httptest.NewRecorder()
	NewHandler().ServeHTTP(res, httptest.NewRequest("GET", "/auth/providers", nil))
	if res.Code != 200 || res.Body.String() != "{\"providers\":[]}\n" {
		t.Fatalf("disabled discovery: status=%d body=%q", res.Code, res.Body.String())
	}
}
