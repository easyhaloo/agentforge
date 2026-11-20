package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
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
	if deps.OIDC == nil {
		unavailable := func(w http.ResponseWriter, _ *http.Request) {
			writeProblem(w, http.StatusServiceUnavailable, "OIDC unavailable", "A validated OIDC provider is not configured")
		}
		mux.HandleFunc("GET /auth/oidc/login", unavailable)
		mux.HandleFunc("GET /auth/oidc/callback", unavailable)
		mux.HandleFunc("GET /auth/invitations/accept", unavailable)
	} else {
		mux.HandleFunc("GET /auth/oidc/login", deps.OIDC.Login)
		mux.HandleFunc("GET /auth/oidc/callback", deps.OIDC.Callback)
		mux.HandleFunc("GET /auth/invitations/accept", deps.OIDC.AcceptInvitation)
	}
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

func writeHealth(w http.ResponseWriter, status int, value string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(healthResponse{Status: value})
}
