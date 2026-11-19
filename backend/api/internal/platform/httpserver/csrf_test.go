package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

type allowCSRF struct {
	err error
}

func (a allowCSRF) ValidateCSRF(context.Context, string, string) error {
	return a.err
}

func addValidCSRFCookies(request *http.Request) {
	request.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: "session-token-with-at-least-32-characters"})
	request.AddCookie(&http.Cookie{Name: identity.CSRFCookieName, Value: "csrf-token-with-at-least-32-characters"})
	request.Header.Set(identity.CSRFHeaderName, "csrf-token-with-at-least-32-characters")
	request.Header.Set("Origin", "https://app.example.test")
}

func TestCSRFMiddlewareAllowsValidSameOriginSession(t *testing.T) {
	called := false
	handler := csrfMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}), allowCSRF{}, "https://app.example.test")

	request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/changesets", nil)
	addValidCSRFCookies(request)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusNoContent {
		t.Fatalf("handler called=%v status=%d, want true and 204", called, response.Code)
	}
}

func TestCSRFMiddlewareRejectsInvalidRequests(t *testing.T) {
	tests := []struct {
		name       string
		setup      func(*http.Request)
		validator  identity.CSRFValidator
		wantStatus int
	}{
		{name: "wrong origin", setup: func(r *http.Request) { addValidCSRFCookies(r); r.Header.Set("Origin", "https://attacker.example") }, validator: allowCSRF{}, wantStatus: http.StatusForbidden},
		{name: "missing origin", setup: func(r *http.Request) { addValidCSRFCookies(r); r.Header.Del("Origin") }, validator: allowCSRF{}, wantStatus: http.StatusForbidden},
		{name: "mismatched header", setup: func(r *http.Request) {
			addValidCSRFCookies(r)
			r.Header.Set(identity.CSRFHeaderName, "different-token")
		}, validator: allowCSRF{}, wantStatus: http.StatusForbidden},
		{name: "session validator rejects token", setup: addValidCSRFCookies, validator: allowCSRF{err: identity.ErrUnauthenticated}, wantStatus: http.StatusForbidden},
		{name: "validator unavailable", setup: addValidCSRFCookies, validator: nil, wantStatus: http.StatusServiceUnavailable},
		{name: "origin not configured", setup: addValidCSRFCookies, validator: allowCSRF{}, wantStatus: http.StatusServiceUnavailable},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := csrfMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Fatal("protected handler must not run")
			}), test.validator, func() string {
				if test.name == "origin not configured" {
					return ""
				}
				return "https://app.example.test"
			}())
			request := httptest.NewRequest(http.MethodPost, "/api/v1/organizations/org-a/changesets", nil)
			test.setup(request)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status=%d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}

func TestCSRFMiddlewareDoesNotBlockSafeMethods(t *testing.T) {
	handler := csrfMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), nil, "")
	request := httptest.NewRequest(http.MethodGet, "/api/v1/organizations/org-a/changesets", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("GET status=%d, want 204", response.Code)
	}
}
