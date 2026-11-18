package httpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

// listFilterCountingIdentity resolves requests for the organizations in known to an owner, answers
// ErrUnauthenticated for any other organization, and counts the lookups. Every delivery handler
// resolves the principal before it touches storage, so zero lookups means no handler ran.
type listFilterCountingIdentity struct {
	known map[string]bool
	calls *int
}

func (i listFilterCountingIdentity) ResolvePrincipal(_ *http.Request, organizationID string) (Principal, error) {
	*i.calls++
	if !i.known[organizationID] {
		return Principal{}, identity.ErrUnauthenticated
	}
	return Principal{UserID: "listfilter-user", OrganizationID: organizationID, Role: "owner"}, nil
}

func listFilterGuardedHandler() (http.Handler, *int) {
	calls := new(int)
	return NewHandlerWithDependencies(DeliveryDependencies{
		Repository: newMemoryRepository(), CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test",
		Identity:   listFilterCountingIdentity{known: map[string]bool{"org-a": true}, calls: calls},
		Membership: &fakeMembershipRepository{}, Catalog: &lifecycleCatalog{},
	}), calls
}

// listFilterProblem decodes an RFC 9457 response and fails unless it has the given status, title and
// content type.
func listFilterProblem(t *testing.T, response *httptest.ResponseRecorder, status int, title string) {
	t.Helper()
	var problem problemResponse
	if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil || response.Code != status ||
		response.Header().Get("Content-Type") != "application/problem+json" || problem.Status != status || problem.Title != title {
		t.Fatalf("status=%d content-type=%q body=%s, want a %d problem titled %q", response.Code, response.Header().Get("Content-Type"), response.Body.String(), status, title)
	}
}

// listFilterExpectMalformed fails unless the response is the guard's 400 problem and no handler ran.
func listFilterExpectMalformed(t *testing.T, response *httptest.ResponseRecorder, calls *int) {
	t.Helper()
	listFilterProblem(t, response, http.StatusBadRequest, "Malformed request")
	if *calls != 0 {
		t.Fatalf("the request reached a handler (%d identity lookups) instead of being rejected up front", *calls)
	}
}

// listFilterMalformedRoutes lists every routed delivery path; {name} marks a slot for an untrusted value.
var listFilterMalformedRoutes = []struct{ method, path string }{
	{http.MethodGet, "/api/v1/organizations/{org}/members"},
	{http.MethodPatch, "/api/v1/organizations/{org}/members/{user}"},
	{http.MethodDelete, "/api/v1/organizations/{org}/members/{user}"},
	{http.MethodGet, "/api/v1/organizations/{org}/invitations"},
	{http.MethodPost, "/api/v1/organizations/{org}/invitations"},
	{http.MethodDelete, "/api/v1/organizations/{org}/invitations/{invitation}"},
	{http.MethodGet, "/api/v1/organizations/{org}/membership-audit"},
	{http.MethodGet, "/api/v1/organizations/{org}/repositories"},
	{http.MethodPost, "/api/v1/organizations/{org}/repositories"},
	{http.MethodGet, "/api/v1/organizations/{org}/changesets"},
	{http.MethodPost, "/api/v1/organizations/{org}/changesets"},
	{http.MethodGet, "/api/v1/organizations/{org}/changesets/{id}"},
	{http.MethodPost, "/api/v1/organizations/{org}/changesets/{id}/revisions"},
	{http.MethodPost, "/api/v1/organizations/{org}/changesets/{id}/evaluations"},
	{http.MethodPost, "/api/v1/organizations/{org}/changesets/{id}/evidence"},
	{http.MethodPost, "/api/v1/organizations/{org}/changesets/{id}/reviews"},
	{http.MethodPost, "/api/v1/organizations/{org}/changesets/{id}/reviews/{review}/decision"},
	{http.MethodPost, "/api/v1/organizations/{org}/changesets/{id}/merge"},
}

// PostgreSQL text holds neither NUL nor invalid UTF-8 (SQLSTATE 22021), so a decoded path or query
// value with either must be refused with a 400 before any handler can pass it to a query. Each
// slot of each route gets each bad value (NUL, NUL inside text, a lone 0xff byte, a truncated
// multi-byte sequence) while the other slots stay well formed.
func TestMalformedTextInThePathIsRejectedOnEveryRoute(t *testing.T) {
	handler, calls := listFilterGuardedHandler()
	good := map[string]string{"org": "org-a", "id": "cs-1", "user": "user-1", "invitation": "invitation-1", "review": "review-1"}
	for _, route := range listFilterMalformedRoutes {
		for slot := range good {
			if !strings.Contains(route.path, "{"+slot+"}") {
				continue
			}
			for _, bad := range []string{"%00", "a%00b", "%ff", "%e5%8f"} {
				target := route.path
				for name, value := range good {
					if name == slot {
						value = bad
					}
					target = strings.ReplaceAll(target, "{"+name+"}", value)
				}
				t.Run(route.method+" "+target, func(t *testing.T) {
					*calls = 0
					listFilterExpectMalformed(t, listFilterRequest(handler, route.method, target, `{}`), calls)
				})
			}
		}
	}
}

func TestMalformedTextInTheQueryIsRejected(t *testing.T) {
	handler, calls := listFilterGuardedHandler()
	for _, target := range []string{
		"/api/v1/organizations/org-a/changesets?repository=%00",
		"/api/v1/organizations/org-a/changesets?repository=a%00b",
		"/api/v1/organizations/org-a/changesets?repository=%ff",
		"/api/v1/organizations/org-a/changesets?repository=%e5%8f",
		"/api/v1/organizations/org-a/changesets?status=%00",
		"/api/v1/organizations/org-a/changesets?reviewer=%ff",
		"/api/v1/organizations/org-a/changesets?q=%00",
		"/api/v1/organizations/org-a/changesets?q=%ff",
		"/api/v1/organizations/org-a/changesets?limit=%00",
		"/api/v1/organizations/org-a/changesets?offset=%ff",
		"/api/v1/organizations/org-a/changesets?repository=team%2Fapi&repository=%00", // one bad value among several
		"/api/v1/organizations/org-a/changesets?%00=x",                                // keys are checked too
		"/api/v1/organizations/org-a/changesets?%ff=x",
		"/api/v1/organizations/org-a/members?limit=%00", // the guard covers every route, not just changesets
		"/healthz?probe=%ff",
		"/auth/oidc/callback?code=%00",
		"/api/v1/me?x=%ff",
	} {
		t.Run(target, func(t *testing.T) {
			*calls = 0
			listFilterExpectMalformed(t, listFilterRequest(handler, http.MethodGet, target, ""), calls)
		})
	}
}

func TestWellFormedRequestsStillReachTheirHandlers(t *testing.T) {
	handler, calls := listFilterGuardedHandler()
	cases := []struct {
		name, method, target, body string
		want                       int
	}{
		{"list", http.MethodGet, "/api/v1/organizations/org-a/changesets", "", http.StatusOK},
		{"list with every filter and multi-byte text", http.MethodGet, "/api/v1/organizations/org-a/changesets?repository=team%2Fapi&status=draft&reviewer=me&q=%E5%8F%98%C3%A9&limit=5&offset=0", "", http.StatusOK},
		{"multi-byte changeset id", http.MethodGet, "/api/v1/organizations/org-a/changesets/%E5%8F%98%C3%A9", "", http.StatusNotFound},
		// The catalog is empty, so the handler itself refuses the unregistered repository with 422: the
		// request got past the guard and CSRF and was judged on its merits.
		{"write with CSRF", http.MethodPost, "/api/v1/organizations/org-a/changesets", `{"repository":"team/api","title":"Normal request"}`, http.StatusUnprocessableEntity},
		{"health", http.MethodGet, "/healthz", "", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			*calls = 0
			if response := listFilterRequest(handler, tc.method, tc.target, tc.body); response.Code != tc.want {
				t.Fatalf("status=%d body=%s, want %d", response.Code, response.Body.String(), tc.want)
			}
			if tc.target != "/healthz" && *calls == 0 {
				t.Fatal("a well-formed request must reach the handler")
			}
		})
	}
}

// The guard sits innermost, around the mux only: request ID, CORS and CSRF run first and answer as
// before, so a write without a valid CSRF proof is refused by the CSRF layer even when its path is
// malformed, and the guard's own 400 still carries the request ID and CORS headers.
func TestMalformedTextGuardRunsInsideRequestIDCORSAndCSRF(t *testing.T) {
	handler, calls := listFilterGuardedHandler()
	const origin = "https://app.example.test"
	const malformedWrite = "/api/v1/organizations/org-a/changesets/%00/merge"
	send := func(method, target string, mutate func(*http.Request)) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, target, strings.NewReader(`{"target_ref":"main"}`))
		mutate(request)
		response := httptest.NewRecorder()
		*calls = 0
		handler.ServeHTTP(response, request)
		return response
	}
	valid := func(request *http.Request) { addValidCSRFCookies(request) }

	listFilterProblem(t, send(http.MethodPost, malformedWrite, func(*http.Request) {}), http.StatusForbidden, "Origin rejected")
	listFilterProblem(t, send(http.MethodPost, malformedWrite, func(r *http.Request) { r.Header.Set("Origin", origin) }), http.StatusUnauthorized, "Authentication required")
	listFilterProblem(t, send(http.MethodPost, malformedWrite, func(r *http.Request) {
		valid(r)
		r.Header.Set(identity.CSRFHeaderName, "a-different-csrf-token-of-enough-length")
	}), http.StatusForbidden, "CSRF validation failed")
	listFilterProblem(t, send(http.MethodPost, malformedWrite, func(r *http.Request) { valid(r); r.Header.Set("Origin", "https://evil.example.test") }), http.StatusForbidden, "Origin rejected")
	if *calls != 0 {
		t.Fatalf("%d identity lookups happened for requests that failed the outer layers", *calls)
	}

	listFilterExpectMalformed(t, send(http.MethodPost, malformedWrite, valid), calls)

	response := send(http.MethodGet, "/api/v1/organizations/org-a/changesets?repository=%00", func(r *http.Request) {
		r.Header.Set("Origin", origin)
		r.Header.Set("X-Request-ID", "listfilter-request-1")
	})
	listFilterExpectMalformed(t, response, calls)
	if got := response.Header().Get("X-Request-ID"); got != "listfilter-request-1" {
		t.Fatalf("X-Request-ID = %q, want the request's own ID on the guard's response", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != origin {
		t.Fatalf("Access-Control-Allow-Origin = %q, want %q on the guard's response", got, origin)
	}
}

// The check is purely syntactic: it answers identically whether or not the organization exists, so
// it cannot be used to enumerate organizations or changesets.
func TestMalformedTextAnswerDoesNotDependOnTheOrganization(t *testing.T) {
	handler, calls := listFilterGuardedHandler()
	body := func(target string) string {
		*calls = 0
		response := listFilterRequest(handler, http.MethodGet, target, "")
		listFilterExpectMalformed(t, response, calls)
		return response.Body.String()
	}
	for _, suffix := range []string{"/changesets?repository=%00", "/changesets/%00", "/members?limit=%ff"} {
		if known, unknown := body("/api/v1/organizations/org-a"+suffix), body("/api/v1/organizations/no-such-org"+suffix); known != unknown {
			t.Fatalf("%s: answer differs by organization:\n known   %s\n unknown %s", suffix, known, unknown)
		}
	}

	// Control: for a well-formed request the identity layer does tell the organizations apart.
	*calls = 0
	listFilterProblem(t, listFilterRequest(handler, http.MethodGet, "/api/v1/organizations/no-such-org/changesets", ""), http.StatusUnauthorized, "Authentication required")
	if *calls == 0 {
		t.Fatal("control request never reached the identity layer")
	}
}
