package httpserver

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
)

func TestRequestIDMiddlewareGeneratesAndPropagatesID(t *testing.T) {
	var contextID string
	handler := requestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contextID = RequestIDFromContext(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))

	requestID := response.Header().Get("X-Request-ID")
	if !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(requestID) {
		t.Fatalf("generated request ID = %q, want 32 lowercase hex characters", requestID)
	}
	if contextID != requestID {
		t.Fatalf("context request ID = %q, header = %q", contextID, requestID)
	}
}

func TestRequestIDMiddlewareAcceptsOnlySafeIncomingIDs(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "safe gateway ID", input: "gateway-123_trace.a", want: "gateway-123_trace.a"},
		{name: "spaces rejected", input: "not safe", want: ""},
		{name: "overlong rejected", input: "12345678901234567890123456789012345678901234567890123456789012345", want: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := requestIDMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			}))
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			if test.input != "" {
				request.Header.Set("X-Request-ID", test.input)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			got := response.Header().Get("X-Request-ID")
			if test.want != "" && got != test.want {
				t.Fatalf("request ID = %q, want %q", got, test.want)
			}
			if test.want == "" && got == test.input {
				t.Fatalf("unsafe request ID %q was accepted", test.input)
			}
		})
	}
}
