package httpserver

import (
	"net/http/httptest"
	"testing"
)

func TestPipelineAuthorization(t *testing.T) {
	for _, tc := range []struct {
		role, method, path string
		want               int
	}{{"viewer", "GET", "", 503}, {"viewer", "POST", "", 403}, {"member", "PUT", "/p/draft", 503}, {"member", "POST", "/p/publish", 403}, {"member", "POST", "/p/archive", 403}, {"admin", "POST", "/p/publish", 503}} {
		t.Run(tc.role+tc.method+tc.path, func(t *testing.T) {
			deps := DeliveryDependencies{Identity: fixedIdentity{role: tc.role}}
			w := httptest.NewRecorder()
			newDeliveryHandler(deps).ServeHTTP(w, httptest.NewRequest(tc.method, "/api/v1/organizations/test/pipelines"+tc.path, nil))
			if w.Code != tc.want {
				t.Fatalf("status %d", w.Code)
			}
		})
	}
}
