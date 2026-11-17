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
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeHealth(w, http.StatusOK, "ok")
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		checker, ok := deps.Repository.(readinessChecker)
		if !ok || deps.Identity == nil || deps.CSRF == nil || strings.TrimSpace(deps.AllowedOrigin) == "" || checker.Ping(r.Context()) != nil {
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
		mux.HandleFunc("POST /api/v1/auth/logout", unavailable)
	} else {
		mux.HandleFunc("GET /auth/oidc/login", deps.OIDC.Login)
		mux.HandleFunc("GET /auth/oidc/callback", deps.OIDC.Callback)
		mux.HandleFunc("POST /api/v1/auth/logout", deps.OIDC.Logout)
	}
	mux.Handle("/", newDeliveryHandler(deps))
	return requestIDMiddleware(corsMiddleware(csrfMiddleware(mux, deps.CSRF, deps.AllowedOrigin), deps.AllowedOrigin))
}

func writeHealth(w http.ResponseWriter, status int, value string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(healthResponse{Status: value})
}
