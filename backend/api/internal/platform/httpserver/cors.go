package httpserver

import (
	"net/http"
	"strings"
)

func corsMiddleware(next http.Handler, allowedOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "" {
			if allowedOrigin == "" || origin != allowedOrigin {
				writeProblem(w, http.StatusForbidden, "Origin rejected", "The request origin is not allowed")
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if origin == "" || allowedOrigin == "" || origin != allowedOrigin {
				writeProblem(w, http.StatusForbidden, "Preflight rejected", "A configured application origin is required")
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
