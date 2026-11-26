package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

type identityOrganizationStatus struct {
	status   string
	deletion bool
}

// sessionTokenFor creates a live session for the user and returns its token.
func sessionTokenFor(t *testing.T, ctx context.Context, store *Store, userID string) string {
	t.Helper()
	token, err := identity.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(ctx, userID, token, token+"-csrf-at-least-32-characters!", time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("create session: %v", err)
	}
	return token
}

// /me must also return suspended and pending-deletion organizations with the
// correct status (SPEC deviation 8). These tests need DATABASE_URL and run in
// CI. All fixtures use per-run unique ids so the shared test database never
// leaks state between runs.

func TestCurrentAccountIncludesNonActiveOrganizations(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := newTestSuffix()
	user := "me-user-" + suffix
	active, suspended, pending := "me-active-"+suffix, "me-suspended-"+suffix, "me-pending-"+suffix
	slugInsertUser(t, ctx, store, user)
	slugInsertOrganization(t, ctx, store, active, active, "active")
	slugInsertOrganization(t, ctx, store, suspended, suspended, "suspended")
	slugInsertOrganization(t, ctx, store, pending, pending, "pending_deletion")
	slugInsertMember(t, ctx, store, active, user, "owner", "active")
	slugInsertMember(t, ctx, store, suspended, user, "owner", "active")
	slugInsertMember(t, ctx, store, pending, user, "owner", "active")

	token := sessionTokenFor(t, ctx, store, user)
	account, err := store.CurrentAccount(ctx, token)
	if err != nil {
		t.Fatalf("current account: %v", err)
	}
	statuses := map[string]identityOrganizationStatus{}
	for _, organization := range account.Organizations {
		statuses[organization.ID] = identityOrganizationStatus{status: organization.Status, deletion: organization.DeletionScheduledAt != nil}
	}
	if got, ok := statuses[active]; !ok || got.status != "active" {
		t.Fatalf("active org missing or wrong: %+v", statuses)
	}
	if got, ok := statuses[suspended]; !ok || got.status != "suspended" {
		t.Fatalf("suspended org must appear in /me with status suspended: %+v", statuses)
	}
	got, ok := statuses[pending]
	if !ok {
		t.Fatalf("pending-deletion org missing from /me: %+v", statuses)
	}
	if got.status != "pending_deletion" {
		t.Fatalf("pending status: %q", got.status)
	}
	// Stamp the deletion deadline so the field is populated, then re-check.
	if _, err := store.pool.Exec(ctx, `UPDATE organizations SET deletion_scheduled_at = now() + interval '48 hours' WHERE id = $1`, pending); err != nil {
		t.Fatal(err)
	}
	account, err = store.CurrentAccount(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	for _, organization := range account.Organizations {
		if organization.ID == pending && organization.DeletionScheduledAt == nil {
			t.Fatal("pending_deletion organization must carry deletion_scheduled_at")
		}
		if organization.ID != pending && organization.DeletionScheduledAt != nil {
			t.Fatalf("non-pending organization carries deletion_scheduled_at: %+v", organization)
		}
	}
}

func TestCurrentAccountStillExcludesRemovedMemberships(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := newTestSuffix()
	user := "me-user-" + suffix
	org := "me-removed-" + suffix
	slugInsertUser(t, ctx, store, user)
	slugInsertOrganization(t, ctx, store, org, org, "active")
	slugInsertMember(t, ctx, store, org, user, "owner", "suspended")
	if _, err := store.CurrentAccount(ctx, sessionTokenFor(t, ctx, store, user)); err == nil {
		t.Fatal("suspended membership must not surface in /me")
	}
	_ = time.Now
}
