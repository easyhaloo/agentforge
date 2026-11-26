package httpserver

import (
	"context"
	"net/http"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

// IdentityStatusSource is the read-side of the shared readiness probe. The
// production Store implements it; tests supply fakes. Defined structurally on
// postgres.IdentityProvidersConfig's shape to avoid an import cycle with the
// postgres package (whose tests import httpserver).
type IdentityStatusSource interface {
	RunIdentityCheck(ctx context.Context, configuration IdentityProvidersProbe) identity.IdentityStatus
}

// IdentityProvidersProbe mirrors postgres.IdentityProvidersConfig without
// importing the postgres package.
type IdentityProvidersProbe struct {
	AppOrigin string
	Providers map[string]ProviderProbe
}

// ProviderProbe mirrors postgres.ProviderProbeConfig.
type ProviderProbe struct {
	IssuerURL        string
	ClientID         string
	SecretConfigured bool
	RedirectURL      string
}

// identityAdmin is parsed once from PLATFORM_ADMIN_SUBJECTS. Empty
// disables the admin identity endpoints entirely.
type identityAdmin struct {
	subjects []string
	source   IdentityStatusSource
	config   IdentityProvidersProbe
}

// isPlatformAdmin checks the session's external identity against the
// configured `issuer|subject` allowlist. The session cookie resolves to a user
// id; matching happens on external identities, not organization roles.
func (a identityAdmin) isPlatformAdmin(r *http.Request) (bool, error) {
	if len(a.subjects) == 0 {
		return false, nil
	}
	store, ok := a.source.(interface {
		PlatformAdminMatch(ctx context.Context, sessionTokenHash string, subjects []string) (bool, error)
	})
	if !ok {
		return false, nil
	}
	cookie, err := r.Cookie(identity.SessionCookieName)
	if err != nil || cookie.Value == "" {
		return false, nil
	}
	return store.PlatformAdminMatch(r.Context(), identity.HashToken(cookie.Value), a.subjects)
}

func (d DeliveryDependencies) adminIdentityRoutes(mux *http.ServeMux) {
	if d.IdentityAdmin == nil || d.IdentityAdmin.source == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/admin/identity", d.getAdminIdentity)
	mux.HandleFunc("POST /api/v1/admin/identity/check", d.runAdminIdentityCheck)
}

func (d DeliveryDependencies) registerAdminIdentity(mux *http.ServeMux) {
	d.adminIdentityRoutes(mux)
}

func (d DeliveryDependencies) registerOrganizationIdentityHealth(mux *http.ServeMux) {
	if d.IdentityAdmin == nil || d.IdentityAdmin.source == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/organizations/{organizationID}/identity-health", d.organizationIdentityHealth)
}

func (d DeliveryDependencies) adminIdentityRequest(w http.ResponseWriter, r *http.Request, runCheck bool) {
	admin, err := d.IdentityAdmin.isPlatformAdmin(r)
	if err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "Identity check unavailable", "The platform administrator lookup failed")
		return
	}
	if !admin {
		writeProblem(w, http.StatusNotFound, "Not found", "No platform administration resource exists for this account")
		return
	}
	status := d.IdentityAdmin.source.RunIdentityCheck(r.Context(), d.IdentityAdmin.config)
	_ = runCheck // both endpoints run the check; the store caches nothing yet
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, status)
}

func (d DeliveryDependencies) getAdminIdentity(w http.ResponseWriter, r *http.Request) {
	d.adminIdentityRequest(w, r, false)
}

func (d DeliveryDependencies) runAdminIdentityCheck(w http.ResponseWriter, r *http.Request) {
	d.adminIdentityRequest(w, r, true)
}

// organizationIdentityHealth returns only what the org status banner needs:
// a ready flag and a human-readable summary (SPEC section 2).
func (d DeliveryDependencies) organizationIdentityHealth(w http.ResponseWriter, r *http.Request) {
	principal, ok := d.principal(w, r, false)
	if !ok {
		return
	}
	if principal.Role != "owner" {
		writeProblem(w, http.StatusForbidden, "Insufficient permissions", "Only organization owners can view identity health")
		return
	}
	if d.IdentityAdmin == nil || d.IdentityAdmin.source == nil {
		writeProblem(w, http.StatusServiceUnavailable, "Identity health unavailable", "The identity readiness probe is not configured")
		return
	}
	status := d.IdentityAdmin.source.RunIdentityCheck(r.Context(), d.IdentityAdmin.config)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Ready   bool   `json:"ready"`
		Summary string `json:"summary"`
	}{Ready: status.Ready, Summary: identityHealthSummary(status)})
}

func identityHealthSummary(status identity.IdentityStatus) string {
	if status.Ready {
		return "ready"
	}
	for _, check := range status.Checks {
		if check.Status != identity.CheckPassed {
			return check.Name + ": " + strings.TrimSpace(check.Error)
		}
	}
	return "not ready"
}
