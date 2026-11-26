package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func TestPostgresCurrentAccountListsOnlyActiveOrganizations(t *testing.T) {
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
	user := "account-user-" + suffix
	orgA := "account-org-a-" + suffix
	orgB := "account-org-b-" + suffix
	email := user + "@example.test"
	for _, org := range []string{orgA, orgB} {
		if _, err := store.pool.Exec(ctx, "INSERT INTO organizations(id,name) VALUES($1,$1)", org); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.pool.Exec(ctx, "INSERT INTO users(id,display_name,email) VALUES($1,'Account User',$2)", user, email); err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, "INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'owner','active'),($3,$2,'viewer','suspended')", orgA, user, orgB); err != nil {
		t.Fatal(err)
	}
	token, err := identity.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	csrf, err := identity.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(ctx, user, token, csrf, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	account, err := store.CurrentAccount(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if account.UserID != user || account.DisplayName != "Account User" || account.Email != email {
		t.Fatalf("account=%#v", account)
	}
	if len(account.Organizations) != 1 || account.Organizations[0].ID != orgA || account.Organizations[0].Role != "owner" {
		t.Fatalf("active organizations=%#v, want only active organization", account.Organizations)
	}
	if _, err := store.CurrentAccount(ctx, "invalid"); !errors.Is(err, identity.ErrUnauthenticated) {
		t.Fatalf("invalid session error=%v", err)
	}
	if err := store.RevokeSession(ctx, token); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CurrentAccount(ctx, token); !errors.Is(err, identity.ErrUnauthenticated) {
		t.Fatalf("revoked session error=%v", err)
	}
}

func TestPostgresCurrentAccountReturnsOrganizationSlugWithIDFallback(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	user := "slug-account-user-" + suffix
	// Organizations are listed by name, then id; a name equal to the id puts "a" before "b".
	withSlug, withoutSlug := "slug-acct-a-"+suffix, "slug-acct-b-"+suffix
	slug := "acct-handle-" + suffix
	slugInsertUser(t, ctx, store, user)
	slugInsertOrganization(t, ctx, store, withSlug, slug, "active")
	slugInsertOrganization(t, ctx, store, withoutSlug, "", "active")
	slugInsertMember(t, ctx, store, withSlug, user, "owner", "active")
	slugInsertMember(t, ctx, store, withoutSlug, user, "member", "active")
	_, token := slugNewSession(t, ctx, store, user)

	account, err := store.CurrentAccount(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	// Check the wire shape that GET /api/v1/me serves, not only the Go struct.
	encoded, err := json.Marshal(account)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Organizations []map[string]any `json:"organizations"`
	}
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	want := []map[string]any{
		{"id": withSlug, "name": withSlug, "role": "owner", "slug": slug, "status": "active"},
		// A NULL slug falls back to the id, so every organization always has a handle.
		{"id": withoutSlug, "name": withoutSlug, "role": "member", "slug": withoutSlug, "status": "active"},
	}
	if len(wire.Organizations) != len(want) {
		t.Fatalf("organizations = %v, want %v", wire.Organizations, want)
	}
	for index := range want {
		for key, value := range want[index] {
			if wire.Organizations[index][key] != value {
				t.Errorf("organizations[%d][%q] = %v, want %v (organization %v)", index, key, wire.Organizations[index][key], value, wire.Organizations[index])
			}
		}
		if len(wire.Organizations[index]) != len(want[index]) {
			t.Errorf("organizations[%d] = %v, want exactly the keys of %v", index, wire.Organizations[index], want[index])
		}
	}
}
