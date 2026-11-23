package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/platform/httpserver"
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

func TestPostgresRepositoryTemplateSettings(t *testing.T) {
	fx := lockOpenStore(t, lockOptions{})
	ctx, store := fx.ctx, fx.store
	owner, outsider := newLockHTTP(t, fx, 0), newLockHTTP(t, fx, 0)
	provider, err := delivery.NewLocalGitProvider(t.TempDir(), time.Minute)
	lockMust(t, err)
	owner.handler = httpserver.NewHandlerWithDependencies(httpserver.DeliveryDependencies{
		Repository: store, Identity: store, CSRF: store, Catalog: store,
		Git: provider, Preview: provider, AllowedOrigin: lockHTTPOrigin,
	})
	outsider.handler = owner.handler
	base := "/api/v1/organizations/" + owner.organizationID + "/repositories"
	source, destination := "team/source", "team/generated"
	check := func(h *lockHTTP, status int, method, path, body string) []byte {
		t.Helper()
		got := h.do(ctx, method, path, body)
		if got.Code != status {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, got.Code, status, got.Body.String())
		}
		return got.Body.Bytes()
	}
	var created delivery.RepositoryMetadata
	lockMust(t, json.Unmarshal(check(owner, 201, "POST", base, `{"slug":"team/source","default_branch":"main","initialize":{"readme":true}}`), &created))
	create := `{"slug":"team/generated","default_branch":"main","initialize":{"template":"team/source"}}`
	check(owner, 422, "POST", base, create)
	check(outsider, 404, "POST", "/api/v1/organizations/"+outsider.organizationID+"/repositories", create)
	update := fmt.Sprintf(`{"description":"Starter project","is_template":true,"updated_at":%q}`, created.UpdatedAt.Format(time.RFC3339Nano))
	_, err = store.pool.Exec(ctx, "INSERT INTO organization_memberships (organization_id,user_id,role,status) VALUES ($1,$2,'member','active')", owner.organizationID, outsider.userID)
	lockMust(t, err)
	check(outsider, 403, "PATCH", base+"/"+source+"/settings", update)
	var updated delivery.RepositoryMetadata
	lockMust(t, json.Unmarshal(check(owner, 200, "PATCH", base+"/"+source+"/settings", update), &updated))
	if !updated.IsTemplate || updated.Description != "Starter project" || !updated.UpdatedAt.After(created.UpdatedAt) {
		t.Fatalf("settings were not saved: %+v", updated)
	}
	check(owner, 409, "PATCH", base+"/"+source+"/settings", update)
	check(owner, 422, "POST", base, strings.Replace(create, `"template":`, `"readme":true,"template":`, 1))
	check(owner, 422, "POST", base, `{"slug":"team/invalid","default_branch":"main","initialize":{"include_all_branches":true}}`)
	git := func(path string, args ...string) string {
		t.Helper()
		output, err := exec.CommandContext(ctx, "git", append([]string{"-C", path}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %s: %v", args, output, err)
		}
		return strings.TrimSpace(string(output))
	}
	original := filepath.Join(provider.Root, owner.organizationID, source)
	sha := git(original, "rev-parse", "HEAD")
	git(original, "branch", "feature/starter", sha)
	git(original, "tag", "v1", sha)
	check(owner, 201, "POST", base, create)
	check(owner, 201, "POST", base, `{"slug":"team/generated-all","default_branch":"main","initialize":{"template":"team/source","include_all_branches":true}}`)
	for _, tc := range []struct {
		slug string
		refs string
	}{
		{destination, "refs/heads/main"},
		{"team/generated-all", "refs/heads/feature/starter\nrefs/heads/main"},
	} {
		repo := filepath.Join(provider.Root, owner.organizationID, tc.slug)
		if got := git(repo, "for-each-ref", "--format=%(refname)"); got != tc.refs {
			t.Fatalf("%s refs = %q, want %q", tc.slug, got, tc.refs)
		}
		if git(repo, "symbolic-ref", "HEAD") != "refs/heads/main" {
			t.Fatal("generated repository should use main as its default")
		}
		seen := make(map[string]bool)
		for _, ref := range strings.Split(tc.refs, "\n") {
			if git(repo, "rev-parse", ref+"^{tree}") != git(original, "rev-parse", ref+"^{tree}") || git(repo, "rev-list", "--count", ref) != "1" {
				t.Fatalf("%s should have the source tree in a single root commit", ref)
			}
			commit := git(repo, "rev-parse", ref)
			if seen[commit] {
				t.Fatalf("%s shares a commit with another generated branch", ref)
			}
			seen[commit] = true
		}
		if _, err := provider.ResolveRevision(ctx, owner.organizationID, tc.slug, sha); err == nil {
			t.Fatal("source commit is accessible by SHA in the generated repository")
		}
	}
	check(owner, 204, "PATCH", base+"/"+source+"/settings", `{"default_branch":"feature/starter","previous_branch":"main"}`)
	var fork delivery.RepositoryMetadata
	lockMust(t, json.Unmarshal(check(owner, 201, "POST", base, `{"slug":"team/generated-custom-default","default_branch":"main","initialize":{"template":"team/source","include_all_branches":true}}`), &fork))
	if fork.DefaultBranch != "feature/starter" {
		t.Fatalf("generated repository default branch = %s", fork.DefaultBranch)
	}
	path := filepath.Join(provider.Root, owner.organizationID, fork.Slug)
	if got := git(path, "symbolic-ref", "HEAD"); got != "refs/heads/feature/starter" {
		t.Fatalf("generated HEAD = %s", got)
	}

}
