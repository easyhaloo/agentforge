package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
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
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
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

var _ delivery.Repository
