package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

func TestPostgresRepositoryCatalogIsOrganizationScoped(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	orgA, orgB, user := "repo-org-a-"+suffix, "repo-org-b-"+suffix, "repo-user-"+suffix
	if _, err = store.pool.Exec(ctx, "INSERT INTO organizations (id,name) VALUES ($1,$1),($2,$2)", orgA, orgB); err != nil {
		t.Fatal(err)
	}
	if _, err = store.pool.Exec(ctx, "INSERT INTO users (id,display_name) VALUES ($1,$1)", user); err != nil {
		t.Fatal(err)
	}
	created, err := store.RegisterRepository(ctx, delivery.RepositoryMetadata{OrganizationID: orgA, Slug: "team/service", DefaultBranch: "main", CreatedBy: user})
	if err != nil {
		t.Fatal(err)
	}
	if created.Slug != "team/service" || created.DefaultBranch != "main" {
		t.Fatalf("created repository=%#v", created)
	}
	items, err := store.ListRepositories(ctx, orgA)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Slug != "team/service" {
		t.Fatalf("organization A repositories=%#v", items)
	}
	other, err := store.ListRepositories(ctx, orgB)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("cross-organization repository leak: %#v", other)
	}
	if _, err = store.RegisterRepository(ctx, delivery.RepositoryMetadata{OrganizationID: orgA, Slug: "team/service", DefaultBranch: "main", CreatedBy: user}); err != delivery.ErrVersionConflict {
		t.Fatalf("duplicate registration error=%v", err)
	}
}

func TestPostgresRepositoryCatalogIconMetadata(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{})
	h := newLockHTTP(t, fx, 0)
	path := "/api/v1/organizations/" + h.organizationID + "/repositories"

	cases := []struct {
		slug       string
		fields     string
		visibility string
		fork       bool
	}{
		{"team/legacy", ``, "", false},
		{"team/unknown", `,"visibility":""`, "", false},
		{"team/private", `,"visibility":"private"`, "private", false},
		{"team/public-fork", `,"visibility":"public","fork":true`, "public", true},
	}
	type metadata struct {
		Slug       string  `json:"slug"`
		Visibility *string `json:"visibility"`
		Fork       *bool   `json:"fork"`
	}
	check := func(item metadata, visibility string, fork bool) {
		t.Helper()
		if item.Fork == nil || *item.Fork != fork ||
			(visibility == "" && item.Visibility != nil) ||
			(visibility != "" && (item.Visibility == nil || *item.Visibility != visibility)) {
			t.Errorf("%s metadata = %#v, want visibility %q and fork %t", item.Slug, item, visibility, fork)
		}
	}
	for _, tc := range cases {
		body := fmt.Sprintf(`{"slug":%q,"default_branch":"main"%s}`, tc.slug, tc.fields)
		response := h.do(fx.ctx, http.MethodPost, path, body)
		if response.Code != http.StatusCreated {
			t.Fatalf("register %s: status %d, body %s", tc.slug, response.Code, response.Body)
		}
		var item metadata
		lockMust(t, json.Unmarshal(response.Body.Bytes(), &item))
		check(item, tc.visibility, tc.fork)
	}
	bad := h.do(fx.ctx, http.MethodPost, path, `{"slug":"team/invalid","default_branch":"main","visibility":"internal"}`)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("invalid visibility: status %d, body %s", bad.Code, bad.Body)
	}

	for _, query := range []string{"", "?details=1"} {
		response := h.do(fx.ctx, http.MethodGet, path+query, "")
		if response.Code != http.StatusOK {
			t.Fatalf("list%s: status %d, body %s", query, response.Code, response.Body)
		}
		var list struct{ Items []metadata }
		lockMust(t, json.Unmarshal(response.Body.Bytes(), &list))
		if len(list.Items) != len(cases) {
			t.Fatalf("list%s: got %d items, want %d", query, len(list.Items), len(cases))
		}
		itemsBySlug := make(map[string]metadata, len(list.Items))
		for _, item := range list.Items {
			itemsBySlug[item.Slug] = item
		}
		for _, tc := range cases {
			item, ok := itemsBySlug[tc.slug]
			if !ok {
				t.Fatalf("list%s: missing %s", query, tc.slug)
			}
			check(item, tc.visibility, tc.fork)
		}
	}
}
