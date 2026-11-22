package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/postgres"
)

func TestPullRequestTitlePostgres(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx := t.Context()
	store, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)
	org := fmt.Sprintf("pr-title-test-%d", time.Now().UnixNano())
	if _, err := store.Pool().Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $1)", org); err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.Pool().Exec(cleanup, "DELETE FROM organizations WHERE id = $1", org); err != nil {
			t.Errorf("clean up test organization: %v", err)
		}
	})

	const valid = `{"title":"Renamed","version":1}`
	unicodeTitle := strings.Repeat("改", 200)
	for _, tc := range []struct {
		name, role, user, state, body, wantTitle string
		status                                   int
	}{
		{"author edits open", "member", "author", "open", `{"title":"　` + unicodeTitle + ` ","version":1}`, unicodeTitle, 200},
		{"owner edits draft", "owner", "other", "draft", valid, "Renamed", 200},
		{"admin edits closed", "admin", "other", "closed", valid, "Renamed", 200},
		{"author edits merged", "member", "author", "merged", valid, "Renamed", 200},
		{"no-op", "member", "author", "open", `{"title":" Original ","version":1}`, "Original", 200},
		{"stale version", "member", "author", "open", valid, "Original", 409},
		{"stale no-op", "member", "author", "open", `{"title":"Original","version":1}`, "Original", 409},
		{"non-PR", "member", "author", "", valid, "Original", 400},
		{"blank", "member", "author", "open", `{"title":"　 ","version":1}`, "Original", 400},
		{"too long", "member", "author", "open", `{"title":"` + unicodeTitle + `改","version":1}`, "Original", 400},
		{"NUL", "member", "author", "open", `{"title":"a\u0000b","version":1}`, "Original", 400},
		{"missing version", "member", "author", "open", `{"title":"Renamed"}`, "Original", 400},
		{"negative version", "member", "author", "open", `{"title":"Renamed","version":-1}`, "Original", 400},
		{"fractional version", "member", "author", "open", `{"title":"Renamed","version":1.5}`, "Original", 400},
		{"non-author member", "member", "other", "open", valid, "Original", 403},
		{"viewer author", "viewer", "author", "open", valid, "Original", 403},
		{"missing CSRF header", "member", "author", "open", valid, "Original", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			changeset, err := delivery.NewChangeset(delivery.ID(strings.ReplaceAll(tc.name, " ", "-")), "owner/repo", "Original", "author", time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}
			changeset.Revisions = []delivery.Revision{{ID: "rev"}}
			changeset.Evaluations = []delivery.Evaluation{{ID: "eval", RevisionID: "rev", Status: delivery.EvaluationPassed}}
			changeset.Evidence = []delivery.Evidence{{ID: "evidence", RevisionID: "rev", EvaluationID: "eval", Status: delivery.EvidenceActive}}
			changeset.Reviews = []delivery.Review{{ID: "review", RevisionID: "rev", Status: delivery.ReviewApproved}}
			if tc.state != "" {
				changeset.PullRequest = &delivery.PullRequest{BaseBranch: "main", SourceBranch: "topic", Draft: tc.state == "draft", Closed: tc.state == "closed"}
			}
			if tc.state == "merged" {
				changeset.Merge = &delivery.Merge{ID: "merge", RevisionID: "rev"}
			}
			created, err := store.Create(ctx, org, changeset)
			if err != nil {
				t.Fatal(err)
			}
			if tc.status == http.StatusConflict {
				created, err = store.Update(ctx, org, changeset, created.Version)
				if err != nil {
					t.Fatal(err)
				}
			}
			handler := NewHandlerWithDependencies(DeliveryDependencies{
				Repository: store, Locker: store, CSRF: allowCSRF{}, AllowedOrigin: "https://app.example.test",
				Identity: &testPrincipal{Principal{OrganizationID: org, UserID: tc.user, Role: tc.role}},
			})
			path := "/api/v1/organizations/" + org + "/changesets/" + string(changeset.ID) + "/pull-request/title"
			req := httptest.NewRequest(http.MethodPatch, path, strings.NewReader(tc.body))
			addValidCSRFCookies(req)
			if tc.name == "missing CSRF header" {
				req.Header.Del(identity.CSRFHeaderName)
			}
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", res.Code, tc.status, res.Body.String())
			}

			want := *changeset
			want.Title = tc.wantTitle
			wantVersion := created.Version
			if want.Title != changeset.Title {
				wantVersion++
			}
			stored, err := store.Get(ctx, org, changeset.ID)
			if err != nil {
				t.Fatal(err)
			}
			if res.Code == http.StatusOK {
				var response storedChangesetResponse
				if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(response, toChangesetResponse(stored)) {
					t.Fatalf("response differs from persisted Changeset: %s", res.Body.String())
				}
			}
			if stored.Version != wantVersion {
				t.Fatalf("stored version = %d, want %d", stored.Version, wantVersion)
			}
			if wantVersion != created.Version {
				audit := stored.Changeset.Audit
				if len(audit) != len(want.Audit)+1 {
					t.Fatalf("expected exactly one audit event: %+v", audit)
				}
				event := audit[len(audit)-1]
				if event.Operation != "pull_request.title_changed" || event.Actor != tc.user || event.TargetID != changeset.ID {
					t.Fatalf("incorrect audit event: %+v", event)
				}
				want.Audit = append(want.Audit, event)
			}
			if !reflect.DeepEqual(stored.Changeset, &want) || stored.Changeset.ValidateMerge() != changeset.ValidateMerge() {
				t.Fatalf("unexpected stored Changeset: %+v, want %+v", stored.Changeset, &want)
			}
			if wantVersion != created.Version {
				items, _, err := store.List(ctx, org, delivery.ListFilter{Query: want.Title}, 100, 0)
				if err != nil || len(items) == 0 || items[0].Changeset.ID != changeset.ID || items[0].Changeset.Title != want.Title {
					t.Fatalf("updated title missing from list: %v, %v", items, err)
				}
			}
		})
	}
}
