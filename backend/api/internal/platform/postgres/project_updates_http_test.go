package postgres

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestProjectUpdatesHTTP(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	fixture := &lockFixture{ctx: ctx, store: store}
	owner := newLockHTTP(t, fixture, 0)
	member := newLockHTTP(t, fixture, 0)
	viewer := newLockHTTP(t, fixture, 0)
	outside := newLockHTTP(t, fixture, 0)
	_, err = store.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role, status)
		VALUES ($1, $2, 'member', 'active'), ($1, $3, 'viewer', 'active')`, owner.organizationID, member.userID, viewer.userID)
	lockMust(t, err)
	_, err = store.pool.Exec(ctx, `UPDATE users SET display_name = 'Release Engineer' WHERE id = $1`, member.userID)
	lockMust(t, err)
	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, AllowedOrigin: lockHTTPOrigin, ProjectRepo: store,
	})
	for _, actor := range []*lockHTTP{owner, member, viewer, outside} {
		actor.handler = handler
	}
	request := func(actor *lockHTTP, method, path, body string, status int, result any) {
		t.Helper()
		res := actor.do(ctx, method, path, body)
		if res.Code != status {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, res.Code, status, res.Body)
		}
		if result != nil {
			lockMust(t, json.Unmarshal(res.Body.Bytes(), result))
		}
	}
	createProject := func(actor *lockHTTP) string {
		projects := "/api/v1/organizations/" + actor.organizationID + "/issue-projects"
		var project issues.Project
		request(actor, http.MethodPost, projects, `{"name":"Release"}`, http.StatusCreated, &project)
		return fmt.Sprintf("%s/%d", projects, project.Number)
	}
	projectPath := createProject(owner)
	updatesPath := projectPath + "/updates"
	otherUpdatesPath := createProject(outside) + "/updates"
	const publish = `{"status":"on_track","body":"# Ready\n\n- Tests passing","start_date":"2026-11-24","target_date":"2026-11-27"}`
	var result struct{ Items []issues.ProjectUpdate }
	request(viewer, http.MethodGet, updatesPath, "", http.StatusOK, &result)
	if result.Items == nil || len(result.Items) != 0 {
		t.Fatalf("expected a non-null empty list: %+v", result.Items)
	}
	request(viewer, http.MethodPost, updatesPath, publish, http.StatusForbidden, nil)
	request(outside, http.MethodGet, updatesPath, "", http.StatusUnauthorized, nil)
	request(outside, http.MethodPost, updatesPath, publish, http.StatusUnauthorized, nil)
	noCSRF := httptest.NewRequest(http.MethodPost, updatesPath, strings.NewReader(publish)).WithContext(ctx)
	noCSRF.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: member.credentials.SessionToken})
	noCSRF.Header.Set("Origin", lockHTTPOrigin)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, noCSRF)
	if res.Code != http.StatusForbidden {
		t.Fatalf("posting without CSRF: %d %s", res.Code, res.Body)
	}
	for _, invalid := range []string{
		`{"status":"done","body":"Invalid status"}`,
		`{"status":"on_track","body":" \n "}`,
		`{"status":"off_track","body":"Invalid date","start_date":"2026-02-30"}`,
		`{"status":"at_risk","body":"Reversed dates","start_date":"2026-11-24","target_date":"2026-11-23"}`,
		fmt.Sprintf(`{"status":"on_track","body":%q}`, strings.Repeat("a", 10001)),
	} {
		request(member, http.MethodPost, updatesPath, invalid, http.StatusUnprocessableEntity, nil)
	}
	request(member, http.MethodPost, updatesPath, `{"status":"on_track","body":"Spoofed author","author_name":"Owner"}`, http.StatusBadRequest, nil)
	var first issues.ProjectUpdate
	request(member, http.MethodPost, updatesPath, publish, http.StatusCreated, &first)
	if first.ID == "" || first.Status != "on_track" || first.Body != "# Ready\n\n- Tests passing" || first.AuthorName != "Release Engineer" ||
		first.CreatedAt.IsZero() || first.StartDate != "2026-11-24" || first.TargetDate != "2026-11-27" {
		t.Fatalf("unexpected created update: %+v", first)
	}
	var second map[string]any
	request(owner, http.MethodPost, updatesPath, `{"status":"at_risk","body":"Waiting for review"}`, http.StatusCreated, &second)
	if second["id"] == nil || second["status"] != "at_risk" || second["start_date"] != nil || second["target_date"] != nil {
		t.Fatalf("unexpected update without dates: %+v", second)
	}
	request(owner, http.MethodPatch, projectPath, `{"version":1,"closed":true}`, http.StatusOK, nil)
	request(member, http.MethodPost, updatesPath, publish, http.StatusConflict, nil)
	request(viewer, http.MethodGet, updatesPath, "", http.StatusOK, &result)
	if len(result.Items) != 2 || result.Items[0].ID != second["id"] || !result.Items[1].CreatedAt.Equal(first.CreatedAt) || result.Items[1].ID != first.ID {
		t.Fatalf("expected both updates in reverse chronological order on a closed project: %+v", result.Items)
	}
	request(outside, http.MethodGet, otherUpdatesPath, "", http.StatusOK, &result)
	if len(result.Items) != 0 {
		t.Fatalf("updates leaked to another organization with the same project number: %+v", result.Items)
	}
	request(owner, http.MethodDelete, projectPath+"?version=2", "", http.StatusNoContent, nil)
	request(viewer, http.MethodGet, updatesPath, "", http.StatusNotFound, nil)
}
