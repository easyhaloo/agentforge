package postgres

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
)

func TestProjectCustomFieldsHTTP(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	fixture := &lockFixture{ctx: ctx, store: store}
	owner := newLockHTTP(t, fixture, 0, "team/one", "team/two")
	admin := newLockHTTP(t, fixture, 0)
	member := newLockHTTP(t, fixture, 0)
	viewer := newLockHTTP(t, fixture, 0)
	outside := newLockHTTP(t, fixture, 0)
	for actor, role := range map[*lockHTTP]string{admin: "admin", member: "member", viewer: "viewer"} {
		_, err := store.pool.Exec(ctx, `INSERT INTO organization_memberships (organization_id, user_id, role, status)
			VALUES ($1, $2, $3, 'active')`, owner.organizationID, actor.userID, role)
		lockMust(t, err)
	}
	handler := httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, Catalog: store, AllowedOrigin: lockHTTPOrigin,
		ProjectRepo: store, IssueRepo: NewIssueRepository(store),
	})
	for _, actor := range []*lockHTTP{owner, admin, member, viewer, outside} {
		actor.handler = handler
	}
	request := func(actor *lockHTTP, method, path, body string, status int, output any) {
		t.Helper()
		res := actor.do(ctx, method, path, body)
		if res.Code != status {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, res.Code, status, res.Body)
		}
		if output != nil {
			lockMust(t, json.Unmarshal(res.Body.Bytes(), output))
		}
	}
	org := "/api/v1/organizations/" + owner.organizationID
	projects := org + "/issue-projects"
	var project issues.Project
	request(owner, "POST", projects, `{"name":"Custom fields"}`, 201, &project)
	projectPath := fmt.Sprintf("%s/%d", projects, project.Number)
	fieldsPath := projectPath + "/fields"
	var defs issues.ProjectFieldDefinitions
	request(outside, "GET", fieldsPath, "", 401, nil)
	request(viewer, "GET", fieldsPath, "", 200, &defs)
	if defs.Fields == nil || len(defs.Fields) != 0 || defs.ProjectVersion != project.Version {
		t.Fatalf("initial custom fields: %+v", defs)
	}
	request(member, "POST", fieldsPath, `{"project_version":1,"name":"Member","type":"text"}`, 403, nil)
	request(viewer, "POST", fieldsPath, `{"project_version":1,"name":"Viewer","type":"text"}`, 403, nil)
	request(admin, "POST", fieldsPath, `{"project_version":1,"name":"Select","type":"single_select","options":[{"name":"same"},{"name":"SAME"}]}`, 422, nil)
	request(admin, "POST", fieldsPath, `{"project_version":1,"name":"Sprint","type":"iteration","options":[{"name":"A","start_date":"2024-03-01","end_date":"2024-02-29"}]}`, 422, nil)
	request(admin, "POST", fieldsPath, `{"project_version":1,"name":"Sprint","type":"iteration","options":[{"name":"A","start_date":"2026-02-29","end_date":"2026-03-03"}]}`, 422, nil)
	request(admin, "POST", fieldsPath, `{"project_version":1,"name":"Field","type":"text","options":[{"name":"A"}]}`, 422, nil)
	request(admin, "POST", fieldsPath, `{"project_version":1,"name":"Select","type":"single_select","options":[{"id":"client-assigned","name":"A"}]}`, 422, nil)

	cases := []struct {
		kind, options, value, invalid string
	}{
		{"text", `[]`, `"Ready 🌱"`, `5`},
		{"number", `[]`, `-12.75`, `"4"`},
		{"date", `[]`, `"2024-02-29"`, `"2025-02-29"`},
		{"single_select", `[{"name":"A"},{"name":"B"}]`, "", `"A"`},
		{"iteration", `[{"name":"First","start_date":"2026-11-25","end_date":"2026-12-01"}]`, "", `"First"`},
	}
	fields := make(map[string]issues.ProjectField, len(cases))
	for _, entry := range cases {
		before := defs.ProjectVersion
		request(admin, "POST", fieldsPath, fmt.Sprintf(`{"project_version":%d,"name":%q,"type":%q,"options":%s}`, before, entry.kind, entry.kind, entry.options), 201, &defs)
		for _, field := range defs.Fields {
			if field.Name == entry.kind {
				fields[entry.kind] = field
			}
		}
		field := fields[entry.kind]
		if field.ID == "" || field.Options == nil || defs.ProjectVersion != before+1 {
			t.Fatalf("created %s: %+v, version %d", entry.kind, field, defs.ProjectVersion)
		}
	}
	request(admin, "POST", fieldsPath, fmt.Sprintf(`{"project_version":%d,"name":"TEXT","type":"text"}`, defs.ProjectVersion), 409, nil)
	request(admin, "PATCH", fieldsPath+"/"+fields["text"].ID, fmt.Sprintf(`{"project_version":%d,"name":"Text","type":"number"}`, defs.ProjectVersion), 422, nil)
	request(admin, "DELETE", fieldsPath+"/"+fields["text"].ID+"?version=1", "", 409, nil)

	var item issues.ProjectItem
	request(member, "POST", projectPath+"/items", `{"kind":"draft","title":"Test values"}`, 201, &item)
	itemPath := projectPath + "/items/" + item.ID
	valuesPath := itemPath + "/field-values"
	var values issues.ProjectFieldValues
	request(viewer, "GET", valuesPath, "", 200, &values)
	if values.Values == nil || len(values.Values) != 0 || values.ItemVersion != item.Version {
		t.Fatalf("initial values: %+v", values)
	}
	textValuePath := valuesPath + "/" + fields["text"].ID
	request(viewer, "PUT", textValuePath, `{"item_version":1,"value":"Forbidden"}`, 403, nil)
	request(outside, "GET", valuesPath, "", 401, nil)
	noCSRF := httptest.NewRequest("PUT", textValuePath, strings.NewReader(`{"item_version":1,"value":"Forbidden"}`)).WithContext(ctx)
	noCSRF.AddCookie(&http.Cookie{Name: identity.SessionCookieName, Value: member.credentials.SessionToken})
	noCSRF.Header.Set("Origin", lockHTTPOrigin)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, noCSRF)
	if res.Code != 403 {
		t.Fatalf("PUT without CSRF: %d %s", res.Code, res.Body)
	}

	for _, entry := range cases {
		field := fields[entry.kind]
		path := valuesPath + "/" + field.ID
		before := values.ItemVersion
		request(member, "PUT", path, fmt.Sprintf(`{"item_version":%d,"value":%s}`, before, entry.invalid), 422, nil)
		value := entry.value
		if value == "" {
			if field.Options[0].ID == "" {
				t.Fatalf("missing stable option ID: %+v", field)
			}
			value = fmt.Sprintf("%q", field.Options[0].ID)
		}
		payload := fmt.Sprintf(`{"item_version":%d,"value":%s}`, before, value)
		values = issues.ProjectFieldValues{}
		request(member, "PUT", path, payload, 200, &values)
		if values.ItemVersion != before+1 || string(values.Values[field.ID]) != value {
			t.Fatalf("stored %s: version %d, value %s", entry.kind, values.ItemVersion, values.Values[field.ID])
		}
		request(member, "PUT", path, payload, 409, nil)
	}
	var loaded issues.ProjectFieldValues
	request(viewer, "GET", valuesPath, "", 200, &loaded)
	if loaded.ItemVersion != values.ItemVersion || len(loaded.Values) != 5 {
		t.Fatalf("loaded values: %+v", loaded)
	}
	var listed struct{ Items []issues.ProjectItem }
	request(viewer, "GET", projectPath+"/items", "", 200, &listed)
	if len(listed.Items) != 1 || listed.Items[0].Version != values.ItemVersion || len(listed.Items[0].FieldValues) != 5 {
		t.Fatalf("project item list omitted custom field values: %+v", listed.Items)
	}

	selectField := fields["single_select"]
	selectPath := fieldsPath + "/" + selectField.ID
	optionA, optionB := selectField.Options[0], selectField.Options[1]
	request(admin, "PATCH", selectPath, fmt.Sprintf(`{"project_version":%d,"name":"Revised select","type":"single_select","options":[{"id":%q,"name":"B"}]}`, defs.ProjectVersion, optionB.ID), 409, nil)
	request(admin, "PATCH", selectPath, fmt.Sprintf(`{"project_version":%d,"name":"Revised select","type":"single_select","options":[{"id":%q,"name":"Renamed"},{"id":%q,"name":"B"}]}`, defs.ProjectVersion, optionA.ID, optionB.ID), 200, &defs)
	var renamed issues.ProjectField
	for _, field := range defs.Fields {
		if field.ID == selectField.ID {
			renamed = field
			break
		}
	}
	if renamed.Name != "Revised select" || len(renamed.Options) != 2 || renamed.Options[0].ID != optionA.ID || renamed.Options[0].Name != "Renamed" {
		t.Fatalf("renamed field or option lost identity: %+v", renamed)
	}
	values = issues.ProjectFieldValues{}
	request(member, "PUT", valuesPath+"/"+selectField.ID, fmt.Sprintf(`{"item_version":%d,"value":null}`, loaded.ItemVersion), 200, &values)
	if _, present := values.Values[selectField.ID]; present {
		t.Fatal("cleared value remains present")
	}
	request(admin, "PATCH", selectPath, fmt.Sprintf(`{"project_version":%d,"name":"Revised select","type":"single_select","options":[{"id":%q,"name":"B"}]}`, defs.ProjectVersion, optionB.ID), 200, &defs)

	var sibling issues.Project
	request(owner, "POST", projects, `{"name":"Sibling","repository":"team/one"}`, 201, &sibling)
	siblingPath := fmt.Sprintf("%s/%d", projects, sibling.Number)
	request(viewer, "GET", siblingPath+"/items/"+item.ID+"/field-values", "", 404, nil)
	request(admin, "DELETE", siblingPath+"/fields/"+fields["text"].ID+"?version=1", "", 404, nil)
	var siblingItem issues.ProjectItem
	request(member, "POST", siblingPath+"/items", `{"kind":"draft","title":"Sibling draft"}`, 201, &siblingItem)
	request(member, "PUT", siblingPath+"/items/"+siblingItem.ID+"/field-values/"+fields["text"].ID, `{"item_version":1,"value":"Wrong project"}`, 404, nil)

	var source issues.Issue
	request(owner, "POST", org+"/issues", `{"repository":"team/two","title":"Mismatched repository"}`, 201, &source)
	// Simulate a legacy association with a registered source outside the project's fixed scope.
	_, err = store.pool.Exec(ctx, `INSERT INTO issue_projects (organization_id, issue_id, project_id) VALUES ($1, $2, $3)`, owner.organizationID, source.ID, sibling.ID)
	lockMust(t, err)
	var mismatchedID string
	lockMust(t, store.pool.QueryRow(ctx, `SELECT id FROM project_items WHERE organization_id = $1 AND project_id = $2 AND issue_id = $3`, owner.organizationID, sibling.ID, source.ID).Scan(&mismatchedID))
	mismatchedPath := siblingPath + "/items/" + mismatchedID + "/field-values"
	request(viewer, "GET", mismatchedPath, "", 404, nil)
	request(member, "PUT", mismatchedPath+"/"+fields["text"].ID, `{"item_version":1,"value":"Wrong scope"}`, 404, nil)

	var outsideProject issues.Project
	outsideProjects := "/api/v1/organizations/" + outside.organizationID + "/issue-projects"
	request(outside, "POST", outsideProjects, `{"name":"Outside"}`, 201, &outsideProject)
	outsidePath := fmt.Sprintf("%s/%d", outsideProjects, outsideProject.Number)
	request(outside, "GET", outsidePath+"/items/"+item.ID+"/field-values", "", 404, nil)
	request(outside, "PATCH", outsidePath+"/fields/"+selectField.ID, `{"project_version":1,"name":"Outside","type":"text"}`, 404, nil)

	request(admin, "DELETE", fieldsPath+"/"+fields["text"].ID+fmt.Sprintf("?version=%d", defs.ProjectVersion), "", 200, &defs)
	loaded = issues.ProjectFieldValues{}
	request(viewer, "GET", valuesPath, "", 200, &loaded)
	if _, present := loaded.Values[fields["text"].ID]; present || len(loaded.Values) != 3 || len(defs.Fields) != 4 {
		t.Fatalf("field deletion did not cascade: %+v, %+v", loaded, defs)
	}
	request(member, "PATCH", itemPath, fmt.Sprintf(`{"version":%d,"archived":true}`, loaded.ItemVersion), 200, &item)
	numberValuePath := valuesPath + "/" + fields["number"].ID
	request(member, "PUT", numberValuePath, fmt.Sprintf(`{"item_version":%d,"value":5}`, item.Version), 409, nil)
	request(viewer, "GET", valuesPath, "", 200, nil)
	request(member, "PATCH", itemPath, fmt.Sprintf(`{"version":%d,"archived":false}`, item.Version), 200, &item)
	request(owner, "PATCH", projectPath, fmt.Sprintf(`{"version":%d,"closed":true}`, defs.ProjectVersion), 200, &project)
	request(member, "PUT", numberValuePath, fmt.Sprintf(`{"item_version":%d,"value":5}`, item.Version), 409, nil)
	request(admin, "POST", fieldsPath, fmt.Sprintf(`{"project_version":%d,"name":"Locked","type":"text"}`, project.Version), 409, nil)
	request(viewer, "GET", valuesPath, "", 200, nil)
	request(viewer, "GET", fieldsPath, "", 200, nil)
}

func TestProjectFieldValueVersionRace(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 2))
	lockMust(t, err)
	t.Cleanup(store.Close)
	owner := newLockHTTP(t, &lockFixture{ctx: ctx, store: store}, 0)
	owner.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Identity: store, CSRF: store, ProjectRepo: store, AllowedOrigin: lockHTTPOrigin,
	})
	response := owner.do(ctx, "POST", "/api/v1/organizations/"+owner.organizationID+"/issue-projects", `{"name":"Race"}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("create project: %d %s", response.Code, response.Body)
	}
	var project issues.Project
	lockMust(t, json.Unmarshal(response.Body.Bytes(), &project))
	defs, err := store.SaveProjectField(ctx, owner.organizationID, project.Number, "", issues.ProjectFieldInput{ProjectVersion: project.Version, Name: "Estimate", Type: issues.ProjectFieldNumber})
	lockMust(t, err)
	item, _, err := store.AddProjectItem(ctx, owner.organizationID, project.Number, issues.ProjectItemInput{Kind: "draft", Title: "Race draft"})
	lockMust(t, err)
	path := fmt.Sprintf("/api/v1/organizations/%s/issue-projects/%d/items/%s/field-values/%s", owner.organizationID, project.Number, item.ID, defs.Fields[0].ID)
	calls := []lockCall{
		{method: "PUT", path: path, body: fmt.Sprintf(`{"item_version":%d,"value":1}`, item.Version)},
		{method: "PUT", path: path, body: fmt.Sprintf(`{"item_version":%d,"value":2}`, item.Version)},
	}
	replies := owner.burst(5*time.Second, calls)
	if replies[0].status+replies[1].status != 200+409 || (replies[0].status != 200 && replies[1].status != 200) {
		t.Fatalf("expected one saved value and one stale version: %+v", replies)
	}
}
