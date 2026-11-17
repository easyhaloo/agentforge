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
		body string
	}{
		{path: "/healthz", body: `{"status":"ok"}
`},
		{path: "/readyz", body: `{"status":"ready"}
`},
	}

	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
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
