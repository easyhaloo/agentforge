package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

type healthResponse struct {
	Status string `json:"status"`
}

type readinessChecker interface {
	Ping(context.Context) error
}

func NewHandler() http.Handler {
	return NewHandlerWithDependencies(DeliveryDependencies{})
}

func NewHandlerWithDependencies(deps DeliveryDependencies) http.Handler {
	mux := http.NewServeMux()
	deps.gitHTTPRoutes(mux)
	mux.HandleFunc("GET /api/v1/me", deps.currentAccount)
	mux.HandleFunc("GET /api/v1/me/identities", deps.listIdentities)
	mux.HandleFunc("POST /api/v1/me/password", deps.changePassword)
	mux.HandleFunc("DELETE /api/v1/me/identities/{identityID}", deps.deleteIdentity)
	// Keep the original settings URLs as aliases with identical session and CSRF checks.
	for _, prefix := range []string{"/api/v1/users/me/", "/api/v1/"} {
		mux.HandleFunc("GET "+prefix+"profile", deps.getProfile)
		mux.HandleFunc("PATCH "+prefix+"profile", deps.updateProfile)
		mux.HandleFunc("GET "+prefix+"preferences", deps.getPreferences)
		mux.HandleFunc("PATCH "+prefix+"preferences", deps.updatePreferences)
		mux.HandleFunc("GET "+prefix+"notification-preferences", deps.getNotificationPreferences)
		mux.HandleFunc("PATCH "+prefix+"notification-preferences", deps.updateNotificationPreferences)
		mux.HandleFunc("GET "+prefix+"authentication-info", deps.getAuthenticationInfo)
		mux.HandleFunc("GET "+prefix+"ssh-keys", deps.listSSHKeys)
		mux.HandleFunc("POST "+prefix+"ssh-keys", deps.addSSHKey)
		mux.HandleFunc("DELETE "+prefix+"ssh-keys/{keyId}", deps.deleteSSHKey)
		mux.HandleFunc("GET "+prefix+"sessions", deps.listSessions)
		mux.HandleFunc("DELETE "+prefix+"sessions/{sessionId}", deps.revokeSession)
		mux.HandleFunc("DELETE "+prefix+"sessions", deps.revokeAllOtherSessions)
		mux.HandleFunc("GET "+prefix+"agent-preferences", deps.getAgentPreferences)
		mux.HandleFunc("PATCH "+prefix+"agent-preferences", deps.updateAgentPreferences)
		mux.HandleFunc("POST "+prefix+"agent-memory/clear", deps.clearAgentMemory)
	}
	mux.HandleFunc("GET /api/v1/users/me/saved-replies", deps.listSavedReplies)
	mux.HandleFunc("POST /api/v1/users/me/saved-replies", deps.writeSavedReply)
	mux.HandleFunc("PATCH /api/v1/users/me/saved-replies/{replyID}", deps.writeSavedReply)
	mux.HandleFunc("DELETE /api/v1/users/me/saved-replies/{replyID}", deps.deleteSavedReply)
	mux.HandleFunc("GET /api/v1/account", deps.getAccount)
	mux.HandleFunc("POST /hooks/github/{hook}", deps.githubPipelineHook)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeHealth(w, http.StatusOK, "ok")
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		checker, ok := deps.Repository.(readinessChecker)
		if !ok || deps.Identity == nil || deps.CSRF == nil || deps.Git == nil || deps.Evaluator == nil || deps.Evidence == nil || deps.Catalog == nil || deps.Locker == nil || deps.Reviewers == nil || strings.TrimSpace(deps.AllowedOrigin) == "" || checker.Ping(r.Context()) != nil {
			writeHealth(w, http.StatusServiceUnavailable, "not_ready")
			return
		}
		writeHealth(w, http.StatusOK, "ready")
	})
	mux.HandleFunc("POST /api/v1/auth/logout", deps.logout)
	registerSSORoutes(mux, deps.SSO)
	if deps.LocalAuth == nil {
		unavailable := func(w http.ResponseWriter, _ *http.Request) {
			writeProblem(w, http.StatusServiceUnavailable, "Local auth unavailable", "Local password authentication is not configured")
		}
		mux.HandleFunc("POST /auth/local/login", unavailable)
		mux.HandleFunc("POST /auth/local/register", unavailable)
	} else {
		mux.HandleFunc("POST /auth/local/login", deps.LocalAuth.Login)
		mux.HandleFunc("POST /auth/local/register", deps.LocalAuth.Register)
	}
	mux.Handle("/", newDeliveryHandler(deps))
	return requestIDMiddleware(corsMiddleware(csrfMiddleware(rejectMalformedText(mux), deps.CSRF, deps.AllowedOrigin), deps.AllowedOrigin))
}

func registerSSORoutes(mux *http.ServeMux, handlers map[string]identity.OIDCHandler) {
	type provider struct {
		ID       string `json:"id"`
		LoginURL string `json:"login_url"`
	}
	unavailable := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		writeProblem(w, http.StatusServiceUnavailable, "SSO unavailable", "The requested SSO provider is not configured or could not be initialized")
	}
	providers := make([]provider, 0, 3)
	for _, id := range []string{"google", "github", "oidc"} {
		prefix := "/auth/" + id
		login, callback := unavailable, unavailable
		if handler := handlers[id]; handler != nil {
			login, callback = handler.Login, handler.Callback
			providers = append(providers, provider{ID: id, LoginURL: prefix + "/login"})
		}
		// ServeMux treats HEAD as GET, but login and callback both change state.
		for _, route := range []string{prefix + "/login", prefix + "/callback"} {
			mux.HandleFunc("HEAD "+route, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Allow", http.MethodGet)
				w.WriteHeader(http.StatusMethodNotAllowed)
			})
		}
		mux.HandleFunc("GET "+prefix+"/login", login)
		mux.HandleFunc("GET "+prefix+"/callback", callback)
	}
	mux.HandleFunc("GET /auth/providers", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(struct {
			Providers []provider `json:"providers"`
		}{Providers: providers})
	})
	accept := unavailable
	if handlers["google"] != nil || handlers["github"] != nil {
		accept = func(w http.ResponseWriter, r *http.Request) {
			identity.AcceptInvitationAt(w, r, "/login?invitation=1")
		}
	} else if legacy := handlers["oidc"]; legacy != nil {
		accept = legacy.AcceptInvitation
	}
	mux.HandleFunc("GET /auth/invitations/accept", accept)
	mux.HandleFunc("HEAD /auth/invitations/accept", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Allow", http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
}

func writeHealth(w http.ResponseWriter, status int, value string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(healthResponse{Status: value})
}
