package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func cryptoRandRead(target []byte) (int, error) { return rand.Read(target) }

// Integration tests for the organization lifecycle store (SPEC section 5).
// They need a real PostgreSQL via DATABASE_URL and run in CI.

func TestOrganizationSuspendDeletionLifecycle(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := newTestSuffix()
	actor := "lifecycle-actor-" + suffix
	org := "org-lifecycle-a-" + suffix
	slugOpenFixtures(t, ctx, store, actor, org)

	// Delete requires suspension first: 409 semantics.
	if _, err := store.ScheduleOrganizationDeletion(ctx, org, actor, time.Hour); !errors.Is(err, ErrOrganizationNotSuspended) {
		t.Fatalf("schedule deletion on active org: %v, want ErrOrganizationNotSuspended", err)
	}

	lifecycle, err := store.SuspendOrganization(ctx, org, actor, "maintenance")
	if err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if lifecycle.Status != "suspended" || lifecycle.SuspendedAt == nil {
		t.Fatalf("suspend state: %+v", lifecycle)
	}

	// Cancel deletion is only valid from pending_deletion.
	if _, err := store.CancelOrganizationDeletion(ctx, org, actor); !errors.Is(err, ErrOrganizationNotSuspended) {
		t.Fatalf("cancel deletion while suspended: %v", err)
	}

	scheduled, err := store.ScheduleOrganizationDeletion(ctx, org, actor, 48*time.Hour)
	if err != nil {
		t.Fatalf("schedule deletion: %v", err)
	}
	if scheduled.Status != "pending_deletion" || scheduled.DeletionScheduledAt == nil {
		t.Fatalf("scheduled state: %+v", scheduled)
	}
	if time.Until(*scheduled.DeletionScheduledAt) < 47*time.Hour {
		t.Fatalf("deletion deadline too early: %v", scheduled.DeletionScheduledAt)
	}

	// Deletion can only be cancelled back to suspended (SPEC).
	restored, err := store.CancelOrganizationDeletion(ctx, org, actor)
	if err != nil {
		t.Fatalf("cancel deletion: %v", err)
	}
	if restored.Status != "suspended" || restored.DeletionScheduledAt != nil {
		t.Fatalf("restored state: %+v", restored)
	}

	// Resume from suspended clears the suspension.
	resumed, err := store.ResumeOrganization(ctx, org, actor)
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	if resumed.Status != "active" || resumed.SuspendedAt != nil {
		t.Fatalf("resumed state: %+v", resumed)
	}
}

func TestOrganizationSlugHistoryReservation(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := newTestSuffix()
	actor := "lifecycle-actor-" + suffix
	orgA, orgB := "org-slug-a-"+suffix, "org-slug-b-"+suffix
	// The fixtures derive each organization's slug from its id minus the
	// "org-" prefix, so the slugs are also per-run unique.
	slugOpenFixtures(t, ctx, store, actor, orgA, orgB)

	slugA := strings.TrimPrefix(orgA, "org-")

	// A slug change retires the old slug for the grace window.
	if _, err := store.UpdateOrganization(ctx, orgA, actor, nil, ptr(slugA+"-new"), 48*time.Hour, 0); err != nil {
		t.Fatalf("change slug: %v", err)
	}
	// The old slug cannot be claimed by another organization while reserved.
	if _, err := store.UpdateOrganization(ctx, orgB, actor, nil, ptr(slugA), 48*time.Hour, 0); !errors.Is(err, ErrSlugUnavailable) {
		t.Fatalf("claim retired slug: %v, want ErrSlugUnavailable", err)
	}
	// The retired slug resolves back to the owning organization (redirects
	// map old addresses, not new ones).
	organizationID, err := store.ResolveSlugRedirect(ctx, slugA)
	if err != nil || organizationID != orgA {
		t.Fatalf("resolve redirect: %q %v", organizationID, err)
	}
	// Invalid slugs are rejected before any write.
	if _, err := store.UpdateOrganization(ctx, orgA, actor, nil, ptr("Bad_Slug!"), time.Hour, 0); !errors.Is(err, ErrSlugInvalid) {
		t.Fatalf("invalid slug: %v, want ErrSlugInvalid", err)
	}
}

func TestOrganizationTransferOwnershipKeepsOneOwner(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := newTestSuffix()
	actor := "lifecycle-actor-" + suffix
	org := "org-transfer-a-" + suffix
	slugOpenFixtures(t, ctx, store, actor, org)
	target := "transfer-target-" + suffix
	slugInsertUser(t, ctx, store, target)
	slugInsertMember(t, ctx, store, org, target, "member", "active")

	member, err := store.TransferOrganizationOwnership(ctx, org, actor, target)
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	if member.Role != "owner" {
		t.Fatalf("target role: %q, want owner", member.Role)
	}
	// The previous owner is demoted, so exactly one active owner remains.
	var owners int
	if err := store.pool.QueryRow(ctx, `SELECT count(*) FROM organization_memberships WHERE organization_id = $1 AND role = 'owner' AND status = 'active'`, org).Scan(&owners); err != nil {
		t.Fatal(err)
	}
	if owners != 1 {
		t.Fatalf("owners after transfer: %d, want 1", owners)
	}
	// Transfers initiated by the demoted former owner are refused.
	if _, err := store.TransferOrganizationOwnership(ctx, org, actor, target); !errors.Is(err, ErrMembershipForbidden) {
		t.Fatalf("demoted-owner transfer: %v, want ErrMembershipForbidden", err)
	}
}

func TestOrganizationAuditMergesMembershipAndLifecycle(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := newTestSuffix()
	actor := "lifecycle-actor-" + suffix
	org := "org-audit-a-" + suffix
	slugOpenFixtures(t, ctx, store, actor, org)
	target := "audit-target-" + suffix
	slugInsertUser(t, ctx, store, target)
	slugInsertMember(t, ctx, store, org, target, "member", "active")

	if _, err := store.UpdateMembership(ctx, org, actor, target, ptr("admin"), nil); err != nil {
		t.Fatalf("role change: %v", err)
	}
	if _, err := store.SuspendOrganization(ctx, org, actor, "reason"); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	events, total, err := store.ListOrganizationAudit(ctx, org, 100, 0)
	if err != nil {
		t.Fatalf("list audit: %v", err)
	}
	if total < 2 || len(events) < 2 {
		t.Fatalf("audit merge: %d events, total %d", len(events), total)
	}
	actions := map[string]bool{}
	for _, event := range events {
		actions[event.Action] = true
	}
	if !actions["role_changed"] || !actions["organization.suspended"] {
		t.Fatalf("missing merged actions: %v", actions)
	}
	if events[0].CreatedAt.Before(events[len(events)-1].CreatedAt) {
		t.Fatalf("events not newest first")
	}
}

func TestOrganizationSelfServiceCreate(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := newTestSuffix()
	actor := "lifecycle-actor-" + suffix
	slugInsertUser(t, ctx, store, actor)

	created, err := store.CreateOrganization(ctx, "org-self-"+suffix, "Self Created", "self-"+suffix, actor)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Status != "active" {
		t.Fatalf("created status: %q", created.Status)
	}
	// Duplicate slugs are refused, including still-reserved retired slugs.
	if _, err := store.CreateOrganization(ctx, "org-self-2-"+suffix, "Other", "self-"+suffix, actor); !errors.Is(err, ErrSlugUnavailable) {
		t.Fatalf("duplicate create: %v, want ErrSlugUnavailable", err)
	}
	var role string
	if err := store.pool.QueryRow(ctx, `SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`, created.ID, actor).Scan(&role); err != nil {
		t.Fatal(err)
	}
	if role != "owner" {
		t.Fatalf("creator role: %q, want owner", role)
	}
}

// ptr returns a pointer to value; helper for optional store arguments.
func ptr[T any](value T) *T { return &value }

// newTestSuffix produces a per-run unique suffix so re-runs never collide.
func newTestSuffix() string {
	return time.Now().UTC().Format("20060102150405") + "-" + newSessionIDSuffix()
}

func newSessionIDSuffix() string {
	var value [4]byte
	_, _ = cryptoRandRead(value[:])
	const digits = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, 0, len(value)*2)
	for _, b := range value {
		out = append(out, digits[int(b)%len(digits)])
	}
	return string(out)
}

// slugOpenFixtures seeds the users and organizations a lifecycle test needs.
func slugOpenFixtures(t *testing.T, ctx context.Context, store *Store, actor string, organizationIDs ...string) {
	t.Helper()
	slugInsertUser(t, ctx, store, actor)
	for _, organizationID := range organizationIDs {
		slugInsertUser(t, ctx, store, organizationID)
		slugInsertOrganization(t, ctx, store, organizationID, strings.TrimPrefix(organizationID, "org-"), "active")
		slugInsertMember(t, ctx, store, organizationID, actor, "owner", "active")
	}
}

func TestOrganizationSlugChangeLengthBoundaries(t *testing.T) {
	ctx, store := slugOpenStore(t)
	suffix := newTestSuffix()
	actor := "lifecycle-actor-" + suffix
	org := "org-slug-len-" + suffix
	slugOpenFixtures(t, ctx, store, actor, org)

	// 2 characters: rejected by the stricter change rule (SPEC deviation 3).
	if _, err := store.UpdateOrganization(ctx, org, actor, nil, ptr("ab"), time.Hour, 0); !errors.Is(err, ErrSlugInvalid) {
		t.Fatalf("2-char slug: %v, want ErrSlugInvalid", err)
	}
	// 3 characters: accepted (suffix keeps it unique across runs).
	if _, err := store.UpdateOrganization(ctx, org, actor, nil, ptr("abc-"+suffix), time.Hour, 0); err != nil {
		t.Fatalf("3-char-prefix slug: %v", err)
	}
	// 40 characters: rejected.
	long40 := "a" + string(repeat('b', 38)) + "c"
	if _, err := store.UpdateOrganization(ctx, org, actor, nil, ptr(long40), time.Hour, 0); !errors.Is(err, ErrSlugInvalid) {
		t.Fatalf("40-char slug: %v, want ErrSlugInvalid", err)
	}
	// Leading and trailing hyphens: rejected.
	if _, err := store.UpdateOrganization(ctx, org, actor, nil, ptr("-abc"), time.Hour, 0); !errors.Is(err, ErrSlugInvalid) {
		t.Fatalf("leading hyphen: %v, want ErrSlugInvalid", err)
	}
	if _, err := store.UpdateOrganization(ctx, org, actor, nil, ptr("abc-"), time.Hour, 0); !errors.Is(err, ErrSlugInvalid) {
		t.Fatalf("trailing hyphen: %v, want ErrSlugInvalid", err)
	}

	// A legacy 2-character slug keeps resolving: reads and routing are
	// unaffected by the change validation. Short slugs may already be taken
	// by an earlier run sharing the database, so try "xy" first and fall back
	// through 16 single-letter-pair variants before giving up.
	legacyUser := "legacy-user-" + suffix
	legacyOrg := "legacy-org-" + suffix
	inserted := false
	for _, legacySlug := range []string{"xy", "x0", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "x9", "xa", "xb", "xc", "xd", "xe", "xf"} {
		if _, err := store.pool.Exec(ctx, `INSERT INTO organizations (id, name, slug, status) VALUES ($1, $1, $2, 'active') ON CONFLICT (slug) DO NOTHING`, legacyOrg, legacySlug); err != nil {
			t.Fatal(err)
		}
		var storedSlug string
		err := store.pool.QueryRow(ctx, `SELECT slug FROM organizations WHERE id = $1`, legacyOrg).Scan(&storedSlug)
		if errors.Is(err, pgx.ErrNoRows) {
			continue // slug taken by another run's organization; try the next
		}
		if err != nil {
			t.Fatal(err)
		}
		inserted = true
		break
	}
	if !inserted {
		t.Fatal("no free 2-character legacy slug available")
	}
	slugInsertUser(t, ctx, store, legacyUser)
	slugInsertMember(t, ctx, store, legacyOrg, legacyUser, "owner", "active")
}
