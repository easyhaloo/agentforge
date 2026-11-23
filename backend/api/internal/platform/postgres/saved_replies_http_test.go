package postgres

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestSavedRepliesHTTP(t *testing.T) {
	ctx, store := slugOpenStore(t)
	const path = "/api/v1/users/me/saved-replies"
	const origin = "https://app.example.test"
	org := fmt.Sprintf("saved-replies-%d", time.Now().UnixNano())
	slugInsertOrganization(t, ctx, store, org, "", "active")
	newSession := func(role string) identity.Credentials {
		t.Helper()
		userID := org + "-" + role
		slugInsertUser(t, ctx, store, userID)
		slugInsertMember(t, ctx, store, org, userID, role, "active")
		credentials, err := identity.GenerateCredentials()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.CreateSession(ctx, userID, credentials.SessionToken, credentials.CSRFToken, time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		return credentials
	}
	owner, viewer := newSession("owner"), newSession("viewer")
	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Account: store, Settings: store, CSRF: store, AllowedOrigin: origin,
	})

	request := func(t *testing.T, credentials identity.Credentials, csrfHeader, method, url, body string, status int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, url, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		if credentials.SessionToken != "" {
			session, csrf := identity.SessionCookies(credentials, time.Now().Add(time.Hour))
			req.AddCookie(session)
			req.AddCookie(csrf)
		}
		req.Header.Set(identity.CSRFHeaderName, csrfHeader)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != status {
			t.Fatalf("%s %s: status %d, want %d: %s", method, url, res.Code, status, res.Body.String())
		}
		if status >= 400 && res.Header().Get("Content-Type") != "application/problem+json" {
			t.Fatalf("%s %s: missing problem response", method, url)
		}
		return res.Body.Bytes()
	}
	do := func(credentials identity.Credentials, method, url, body string, status int) []byte {
		t.Helper()
		return request(t, credentials, credentials.CSRFToken, method, url, body, status)
	}
	checkList := func(credentials identity.Credentials, want ...identity.SavedReply) {
		t.Helper()
		var result struct {
			Items []identity.SavedReply `json:"items"`
		}
		if err := json.Unmarshal(do(credentials, "GET", path, "", 200), &result); err != nil {
			t.Fatal(err)
		}
		if result.Items == nil || !slices.Equal(result.Items, want) {
			t.Fatalf("listed %d items, expected %d and identical values (nil list: %t)", len(result.Items), len(want), result.Items == nil)
		}
	}
	decodeReply := func(response []byte) identity.SavedReply {
		t.Helper()
		var reply identity.SavedReply
		if err := json.Unmarshal(response, &reply); err != nil {
			t.Fatal(err)
		}
		if reply.ID == "" {
			t.Fatal("saved reply ID is empty")
		}
		return reply
	}
	payload := func(title, body string) string {
		data, err := json.Marshal(map[string]string{"title": title, "body": body})
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}

	do(identity.Credentials{}, "GET", path, "", 401)
	do(identity.Credentials{}, "POST", path, payload("Example", "Markdown"), 401)
	request(t, owner, "", "POST", path, payload("Example", "Markdown"), 403)
	checkList(owner)

	title := strings.Repeat("🚀", 100)
	body := "\n    code block\n\nThank you!  \n"
	reply := decodeReply(do(owner, "POST", path, payload("  "+title+"  ", body), 201))
	if reply.Title != title || reply.Body != body {
		t.Fatal("saved title or Markdown was changed unexpectedly")
	}
	itemPath := path + "/" + reply.ID
	checkList(owner, reply)
	checkList(viewer)
	do(viewer, "PATCH", itemPath, payload("Other account", "Cannot edit"), 404)
	do(viewer, "DELETE", itemPath, "", 404)
	do(owner, "DELETE", path+"/unknown-id", "", 404)
	request(t, owner, viewer.CSRFToken, "PATCH", itemPath, payload("CSRF", "Cannot edit"), 403)
	request(t, owner, "", "DELETE", itemPath, "", 403)
	other := decodeReply(do(viewer, "POST", path, payload("Viewer's reply", "Account scoped"), 201))
	checkList(viewer, other)
	checkList(owner, reply)

	for _, tc := range []struct{ name, body string }{
		{"missing title", `{"body":"Markdown"}`},
		{"missing body", `{"title":"Example"}`},
		{"null body", `{"title":"Example","body":null}`},
		{"blank title", payload(" \u2003\n", "Markdown")},
		{"blank body", payload("Example", "\u2003\n\t ")},
		{"oversized title", payload(title+"a", "Markdown")},
		{"oversized body", payload("Example", strings.Repeat("🚀", 8192)+"a")},
		{"NUL body", payload("Example", "Markdown\x00")},
		{"unknown field", `{"title":"Example","body":"Markdown","userID":"another-user"}`},
		{"trailing JSON", `{"title":"Example","body":"Markdown"}{}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request(t, owner, owner.CSRFToken, "POST", path, tc.body, 400)
			request(t, owner, owner.CSRFToken, "PATCH", itemPath, tc.body, 400)
		})
	}
	checkList(owner, reply)

	limit := strings.Repeat("界", 16382) + "🚀"
	updated := decodeReply(do(owner, "PATCH", itemPath, payload("Updated", limit), 200))
	if updated.ID != reply.ID || updated.Title != "Updated" || updated.Body != limit {
		t.Fatal("update did not preserve ID and the exact Markdown at the UTF-16 limit")
	}
	checkList(owner, updated)
	if body := do(owner, "DELETE", itemPath, "", 204); len(body) != 0 {
		t.Fatal("delete returned a body")
	}
	checkList(owner)
	do(owner, "DELETE", itemPath, "", 404)
	do(owner, "PATCH", itemPath, payload("Already deleted", "Markdown"), 404)
	checkList(viewer, other)
}
