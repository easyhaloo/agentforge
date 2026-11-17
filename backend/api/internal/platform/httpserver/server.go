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
	mux.Handle("/", newDeliveryHandler(deps))
	return requestIDMiddleware(csrfMiddleware(mux, deps.CSRF, deps.AllowedOrigin))
}

func writeHealth(w http.ResponseWriter, status int, value string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(healthResponse{Status: value})
}
