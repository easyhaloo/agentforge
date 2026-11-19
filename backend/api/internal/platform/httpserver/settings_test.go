package httpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

var settingsResources = []string{"profile", "preferences", "authentication-info", "notification-preferences", "agent-preferences", "sessions", "ssh-keys"}

func TestSettingsRequireSession(t *testing.T) {
	handler := NewHandler()
	for _, prefix := range []string{"/api/v1/users/me/", "/api/v1/"} {
		for _, resource := range settingsResources {
			req := httptest.NewRequest(http.MethodGet, prefix+resource, nil)
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != http.StatusUnauthorized {
				t.Fatalf("%s: %d", req.URL.Path, res.Code)
			}
		}
	}
}

func TestSettingsPostgresRoundTrip(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx := t.Context()
	store, err := postgres.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const origin = "https://app.example.test"
	handler := NewHandlerWithDependencies(DeliveryDependencies{Account: store, Settings: store, CSRF: store, AllowedOrigin: origin})
	newSession := func(user string) identity.Credentials {
		t.Helper()
		cred, err := identity.GenerateCredentials()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.CreateSession(ctx, user, cred.SessionToken, cred.CSRFToken, time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		return cred
	}
	newUser := func() string {
		t.Helper()
		email := fmt.Sprintf("settings-%d@example.test", time.Now().UnixNano())
		user, _, err := store.CreateOrUpdateLocalUser(ctx, email, "password123", "QA")
		if err != nil {
			t.Fatal(err)
		}
		return user
	}
	doRequest := func(t *testing.T, cred identity.Credentials, method, resource, body string, status int) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1/users/me/"+resource, strings.NewReader(body))
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		session, csrf := identity.SessionCookies(cred, time.Now().Add(time.Hour))
		req.AddCookie(session)
		req.AddCookie(csrf)
		req.Header.Set(identity.CSRFHeaderName, cred.CSRFToken)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s %s: status %d, want %d", method, resource, res.Code, status)
		}
		if res.Body.Len() == 0 {
			if status != 204 {
				t.Fatal("missing body")
			}
			return nil
		}
		var result map[string]any
		if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	request := func(cred identity.Credentials, method, resource, body string, status int) map[string]any {
		t.Helper()
		return doRequest(t, cred, method, resource, body, status)
	}
	aID := newUser()
	a := newSession(aID)
	b := newSession(newUser())
	for _, tc := range []struct {
		resource, first, initial, left, right, final string
	}{
		{"notification-preferences", `{"notification_frequency":"daily"}`,
			`{"notification_frequency":"daily","web_push_enabled":false,"email_notifications":{"evaluation_complete":true,"review_assigned":true,"changeset_status":true,"org_invitation":true}}`,
			`{"email_notifications":{"review_assigned":false}}`, `{"email_notifications":{"org_invitation":false},"web_push_enabled":true}`,
			`{"notification_frequency":"daily","web_push_enabled":true,"email_notifications":{"evaluation_complete":true,"review_assigned":false,"changeset_status":true,"org_invitation":false}}`},
		{"agent-preferences", `{"output_verbosity":"verbose"}`,
			`{"output_verbosity":"verbose","cross_session_memory_enabled":true,"notify_evaluation_results":true}`,
			`{"cross_session_memory_enabled":false,"review_focus":{"security":false}}`, `{"review_focus":{"documentation":true}}`,
			`{"output_verbosity":"verbose","cross_session_memory_enabled":false,"notify_evaluation_results":true,"review_focus":{"security":false,"performance":true,"test_coverage":true,"code_style":false,"documentation":true}}`},
		{"preferences", `{"theme":"dark"}`, `{"theme":"dark","language":"en-US","timezone":"UTC"}`,
			`{"language":"zh-CN"}`, `{"timezone":"Asia/Shanghai"}`, `{"theme":"dark","language":"zh-CN","timezone":"Asia/Shanghai"}`},
	} {
		t.Run(tc.resource+" partial PATCH", func(t *testing.T) {
			check := func(got map[string]any, wantJSON string) {
				t.Helper()
				var want map[string]any
				if err := json.Unmarshal([]byte(wantJSON), &want); err != nil {
					t.Fatal(err)
				}
				for k, v := range want {
					if !reflect.DeepEqual(got[k], v) {
						t.Errorf("%s = %v, want %v", k, got[k], v)
					}
				}
			}
			check(doRequest(t, a, "PATCH", tc.resource, tc.first, 200), tc.initial)
			t.Run("concurrent disjoint updates", func(t *testing.T) {
				for _, body := range []string{tc.left, tc.right} {
					t.Run(body, func(t *testing.T) {
						t.Parallel()
						doRequest(t, a, "PATCH", tc.resource, body, 200)
					})
				}
			})
			check(doRequest(t, a, "GET", tc.resource, "", 200), tc.final)
		})
	}
	for _, resource := range settingsResources {
		request(a, "GET", resource, "", 200)
	}
	for _, tc := range []struct {
		resource, body, field string
		want                  any
	}{
		{"profile", `{"display_name":"Ada","bio":"Builds","location":"Shanghai"}`, "display_name", "Ada"},
		{"profile", `{"bio":"Writes"}`, "location", "Shanghai"},
		{"preferences", `{"theme":"dark","language":"zh-CN","timezone":"UTC"}`, "theme", "dark"},
		{"notification-preferences", `{"notification_frequency":"daily","web_push_enabled":true}`, "web_push_enabled", true},
		{"agent-preferences", `{"output_verbosity":"verbose","confirmation_strategy":"batch","automation_level":"balanced","evaluation_strictness":"strict"}`, "output_verbosity", "verbose"},
	} {
		request(a, "PATCH", tc.resource, tc.body, 200)
		if request(a, "GET", tc.resource, "", 200)[tc.field] != tc.want {
			t.Fatalf("%s did not persist %s", tc.resource, tc.field)
		}
	}
	if request(a, "GET", "profile", "", 200)["bio"] != "Writes" {
		t.Fatal("bio did not persist")
	}
	badCSRF := a
	badCSRF.CSRFToken = b.CSRFToken
	request(badCSRF, "PATCH", "profile", `{"bio":"rejected"}`, 403)
	request(a, "POST", "agent-memory/clear", "", 501)
	if keys := request(a, "GET", "ssh-keys", "", 200)["keys"].([]any); len(keys) != 0 {
		t.Fatal("expected empty key list")
	}
	key := request(a, "POST", "ssh-keys", `{"title":"QA","public_key":"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOM+E9z0B7YBkSl0J5hRwNGWvAOCEHp6Z1yNB9FbVbL3"}`, 201)["key_id"].(string)
	if len(request(b, "GET", "ssh-keys", "", 200)["keys"].([]any)) != 0 {
		t.Fatal("foreign key listed")
	}
	request(b, "DELETE", "ssh-keys/"+key, "", 400)
	request(a, "DELETE", "ssh-keys/"+key, "", 204)
	other := newSession(aID)
	sessions := request(a, "GET", "sessions", "", 200)["sessions"].([]any)
	if len(sessions) != 2 {
		t.Fatalf("expected two own sessions, got %d", len(sessions))
	}
	var otherID string
	for _, item := range sessions {
		session := item.(map[string]any)
		id := session["session_id"].(string)
		if session["user_id"] != aID || id == a.SessionToken || id == other.SessionToken {
			t.Fatal("unsafe session listing")
		}
		if session["is_current"] == false {
			otherID = id
		}
	}
	if otherID == "" {
		t.Fatal("missing other session")
	}
	request(b, "DELETE", "sessions/"+otherID, "", 400)
	request(a, "DELETE", "sessions/"+otherID, "", 204)
	request(other, "GET", "profile", "", 401)
	sibling := newSession(aID)
	if request(a, "DELETE", "sessions", "", 200)["revoked_count"] != float64(1) {
		t.Fatal("expected one revoked sibling")
	}
	request(sibling, "GET", "profile", "", 401)
	request(a, "GET", "profile", "", 200)
	request(b, "GET", "profile", "", 200)
}
