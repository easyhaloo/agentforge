package httpserver

import (
	"context"
	"encoding/json"
	"net/http"

	)

type healthResponse struct {
	Status string `json:"status"`
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
		if checker, ok := deps.Repository.(interface{ Ping(context.Context) error }); ok {
			if err := checker.Ping(r.Context()); err != nil {
				writeHealth(w, http.StatusServiceUnavailable, "not_ready")
				return
			}
		}
		writeHealth(w, http.StatusOK, "ready")
	})
	mux.Handle("/", newDeliveryHandler(deps))
	return mux
}

func writeHealth(w http.ResponseWriter, status int, value string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(healthResponse{Status: value})
}

