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
	mux.HandleFunc("GET /api/v1/profile", deps.getProfile)
	mux.HandleFunc("PATCH /api/v1/profile", deps.updateProfile)

	// Settings endpoints
	mux.HandleFunc("GET /api/v1/preferences", deps.getPreferences)
	mux.HandleFunc("PATCH /api/v1/preferences", deps.updatePreferences)
	mux.HandleFunc("GET /api/v1/notification-preferences", deps.getNotificationPreferences)
	mux.HandleFunc("PATCH /api/v1/notification-preferences", deps.updateNotificationPreferences)
	mux.HandleFunc("GET /api/v1/authentication-info", deps.getAuthenticationInfo)
	mux.HandleFunc("GET /api/v1/ssh-keys", deps.listSSHKeys)
	mux.HandleFunc("POST /api/v1/ssh-keys", deps.addSSHKey)
	mux.HandleFunc("DELETE /api/v1/ssh-keys/{keyId}", deps.deleteSSHKey)
	mux.HandleFunc("GET /api/v1/sessions", deps.listSessions)
	mux.HandleFunc("DELETE /api/v1/sessions/{sessionId}", deps.revokeSession)
	mux.HandleFunc("DELETE /api/v1/sessions", deps.revokeAllOtherSessions)
	mux.HandleFunc("GET /api/v1/agent-preferences", deps.getAgentPreferences)
	mux.HandleFunc("PATCH /api/v1/agent-preferences", deps.updateAgentPreferences)
	mux.HandleFunc("POST /api/v1/agent-memory/clear", deps.clearAgentMemory)
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
	if deps.OIDC == nil {
		unavailable := func(w http.ResponseWriter, _ *http.Request) {
			writeProblem(w, http.StatusServiceUnavailable, "OIDC unavailable", "A validated OIDC provider is not configured")
		}
		mux.HandleFunc("GET /auth/oidc/login", unavailable)
		mux.HandleFunc("GET /auth/oidc/callback", unavailable)
		mux.HandleFunc("GET /auth/invitations/accept", unavailable)
		mux.HandleFunc("POST /api/v1/auth/logout", unavailable)
	} else {
		mux.HandleFunc("GET /auth/oidc/login", deps.OIDC.Login)
		mux.HandleFunc("GET /auth/oidc/callback", deps.OIDC.Callback)
		mux.HandleFunc("GET /auth/invitations/accept", deps.OIDC.AcceptInvitation)
		mux.HandleFunc("POST /api/v1/auth/logout", deps.OIDC.Logout)
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
