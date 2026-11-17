package httpserver

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func csrfMiddleware(next http.Handler, validator identity.CSRFValidator, allowedOrigin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || r.Method == http.MethodGet ||
			r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		if validator == nil || strings.TrimSpace(allowedOrigin) == "" {
			writeProblem(w, http.StatusServiceUnavailable, "CSRF protection unavailable", "A session-bound CSRF validator and application origin are required")
			return
		}
		origin := r.Header.Get("Origin")
		if origin == "" || origin != allowedOrigin {
			writeProblem(w, http.StatusForbidden, "Origin rejected", "The request origin is not allowed")
			return
		}
		parsedOrigin, err := url.Parse(origin)
		if err != nil || parsedOrigin.Scheme == "" || parsedOrigin.Host == "" || parsedOrigin.User != nil ||
			parsedOrigin.RawQuery != "" || parsedOrigin.Fragment != "" || parsedOrigin.Path != "" {
			writeProblem(w, http.StatusForbidden, "Origin rejected", "The request origin is invalid")
			return
		}

		sessionCookie, err := r.Cookie(identity.SessionCookieName)
		if err != nil || sessionCookie.Value == "" {
			writeProblem(w, http.StatusUnauthorized, "Authentication required", "A valid session cookie is required")
			return
		}
		csrfCookie, err := r.Cookie(identity.CSRFCookieName)
		headerToken := r.Header.Get(identity.CSRFHeaderName)
		if err != nil || csrfCookie.Value == "" || headerToken == "" ||
			subtle.ConstantTimeCompare([]byte(csrfCookie.Value), []byte(headerToken)) != 1 {
			writeProblem(w, http.StatusForbidden, "CSRF validation failed", "The CSRF cookie and request header must match")
			return
		}
		if err := validator.ValidateCSRF(r.Context(), sessionCookie.Value, headerToken); errors.Is(err, identity.ErrUnauthenticated) {
			writeProblem(w, http.StatusForbidden, "CSRF validation failed", "The CSRF token is not bound to an active session")
			return
		} else if err != nil {
			writeProblem(w, http.StatusServiceUnavailable, "CSRF validation unavailable", "The session security state could not be verified")
			return
		}
		next.ServeHTTP(w, r)
	})
}
