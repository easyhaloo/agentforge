package postgres

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func TestPostgresOrganizationMembershipAdministration(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	org := "membership-org-" + suffix
	users := map[string]string{
		"owner":  "membership-owner-" + suffix,
		"owner2": "membership-owner2-" + suffix,
		"admin":  "membership-admin-" + suffix,
		"member": "membership-member-" + suffix,
	}
	if _, err := store.pool.Exec(ctx, "INSERT INTO organizations (id,name) VALUES ($1,$1)", org); err != nil {
		t.Fatal(err)
	}
	for _, id := range users {
		if _, err := store.pool.Exec(ctx, "INSERT INTO users (id,display_name,email) VALUES ($1,$1,$2)", id, id+"@example.test"); err != nil {
			t.Fatal(err)
		}
	}
	for key, role := range map[string]string{"owner": "owner", "owner2": "owner", "admin": "admin", "member": "member"} {
		if _, err := store.pool.Exec(ctx, "INSERT INTO organization_memberships (organization_id,user_id,role,status) VALUES ($1,$2,$3,'active')", org, users[key], role); err != nil {
			t.Fatal(err)
		}
	}

	members, err := store.ListMembers(ctx, org, 100, 0)
	if err != nil || len(members) != 4 {
		t.Fatalf("list members count=%d err=%v, want 4", len(members), err)
	}

	viewer := "viewer"
	if _, err := store.UpdateMembership(ctx, org, users["admin"], users["member"], &viewer, nil); err != nil {
		t.Fatalf("admin should be able to change member to viewer: %v", err)
	}
	adminRole := "member"
	if _, err := store.UpdateMembership(ctx, org, users["admin"], users["admin"], &adminRole, nil); !errors.Is(err, identity.ErrMembershipForbidden) {
		t.Fatalf("admin self-demotion error=%v, want forbidden", err)
	}
	ownerRole := "member"
	if _, err := store.UpdateMembership(ctx, org, users["admin"], users["owner"], &ownerRole, nil); !errors.Is(err, identity.ErrMembershipForbidden) {
		t.Fatalf("admin changing owner error=%v, want forbidden", err)
	}

	if err := store.RemoveMembership(ctx, org, users["owner"], users["owner2"]); err != nil {
		t.Fatalf("owner should remove second owner while retaining own ownership: %v", err)
	}
	if _, err := store.UpdateMembership(ctx, org, users["owner"], users["owner"], &ownerRole, nil); !errors.Is(err, identity.ErrLastActiveOwner) {
		t.Fatalf("last owner demotion error=%v, want last-owner protection", err)
	}
	if err := store.RemoveMembership(ctx, org, users["owner"], users["owner"]); !errors.Is(err, identity.ErrLastActiveOwner) {
		t.Fatalf("last owner removal error=%v, want last-owner protection", err)
	}

	if err := store.RemoveMembership(ctx, org, users["owner"], users["member"]); err != nil {
		t.Fatalf("owner remove member: %v", err)
	}
	var status string
	if err := store.pool.QueryRow(ctx, "SELECT status FROM organization_memberships WHERE organization_id=$1 AND user_id=$2", org, users["member"]).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "removed" {
		t.Fatalf("removed membership status=%q, want removed", status)
	}
	var auditCount int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM organization_membership_audit WHERE organization_id=$1", org).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if auditCount != 3 {
		t.Fatalf("membership audit count=%d, want 2", auditCount)
	}
}
