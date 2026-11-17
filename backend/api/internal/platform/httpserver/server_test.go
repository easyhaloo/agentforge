package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthEndpoints(t *testing.T) {
	handler := NewHandler()
	tests := []struct {
		path string
		status int
		body string
	}{
		{path: "/healthz", status: http.StatusOK, body: "{\"status\":\"ok\"}\n"},
		{path: "/readyz", status: http.StatusServiceUnavailable, body: "{\"status\":\"not_ready\"}\n"},
	}

	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
			if got := response.Body.String(); got != test.body {
				t.Fatalf("body = %q, want %q", got, test.body)
			}
			if got := response.Header().Get("Content-Type"); got != "application/json" {
				t.Fatalf("Content-Type = %q, want application/json", got)
			}
		})
	}
}

func TestReadinessRequiresDatabaseAndIdentity(t *testing.T) {
	handler := NewHandlerWithDependencies(DeliveryDependencies{
		Repository: newMemoryRepository(),
		Identity: fixedIdentity{role: "member"},
	})
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "{\"status\":\"ready\"}\n" {
		t.Fatalf("readiness response = %d %q, want ready", response.Code, response.Body.String())
	}

	handler = NewHandlerWithDependencies(DeliveryDependencies{Repository: newMemoryRepository()})
	request = httptest.NewRequest(http.MethodGet, "/readyz", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness without identity = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}

}
