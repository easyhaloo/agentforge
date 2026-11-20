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

func TestPostgresOrganizationInvitationLifecycle(t *testing.T) {
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
	org := "invite-org-" + suffix
	owner := "invite-owner-" + suffix
	admin := "invite-admin-" + suffix
	if _, err := store.pool.Exec(ctx, "INSERT INTO organizations(id,name) VALUES($1,$1)", org); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct{ id, role string }{{owner, "owner"}, {admin, "admin"}} {
		if _, err := store.pool.Exec(ctx, "INSERT INTO users(id,display_name,email) VALUES($1,$1,$2)", entry.id, entry.id+"@example.test"); err != nil {
			t.Fatal(err)
		}
		if _, err := store.pool.Exec(ctx, "INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,$3,'active')", org, entry.id, entry.role); err != nil {
			t.Fatal(err)
		}
	}

	token, err := identity.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := store.CreateInvitation(ctx, org, owner, "  New.User@Example.Test  ", "member", identity.HashToken(token), time.Now().Add(7*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if invitation.Email != "new.user@example.test" || invitation.Status != "pending" {
		t.Fatalf("invitation=%#v", invitation)
	}
	if _, err := store.CreateInvitation(ctx, org, owner, "new.user@example.test", "viewer", identity.HashToken(token+"duplicate"), time.Now().Add(7*24*time.Hour)); !errors.Is(err, identity.ErrInvitationPending) {
		t.Fatalf("duplicate invitation error=%v, want pending", err)
	}
	if _, err := store.CreateInvitation(ctx, org, admin, "another@example.test", "admin", identity.HashToken(token+"admin"), time.Now().Add(7*24*time.Hour)); !errors.Is(err, identity.ErrMembershipForbidden) {
		t.Fatalf("admin privilege grant error=%v, want forbidden", err)
	}
	invitee, err := store.UpsertExternalIdentity(ctx, "https://issuer.example.test", "subject-"+suffix, "new.user@example.test", "New User")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AcceptInvitation(ctx, identity.HashToken(token), "wrong@example.test", invitee); !errors.Is(err, identity.ErrInvitationNotFound) {
		t.Fatalf("wrong email acceptance error=%v, want not found", err)
	}
	acceptedOrg, err := store.AcceptInvitation(ctx, identity.HashToken(token), "NEW.USER@example.test", invitee)
	if err != nil || acceptedOrg != org {
		t.Fatalf("accept invitation org=%q err=%v", acceptedOrg, err)
	}
	if _, err := store.AcceptInvitation(ctx, identity.HashToken(token), "new.user@example.test", invitee); !errors.Is(err, identity.ErrInvitationNotFound) {
		t.Fatalf("replay acceptance error=%v, want not found", err)
	}
	var role, status string
	if err := store.pool.QueryRow(ctx, "SELECT role,status FROM organization_memberships WHERE organization_id=$1 AND user_id=$2", org, invitee).Scan(&role, &status); err != nil {
		t.Fatal(err)
	}
	if role != "member" || status != "active" {
		t.Fatalf("accepted membership role=%q status=%q", role, status)
	}
	events, err := store.ListMembershipAudit(ctx, org, 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Action != "invite_accepted" || events[0].TargetUserID != invitee {
		t.Fatalf("audit events=%#v", events)
	}

	revokeToken, err := identity.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	revokeInvite, err := store.CreateInvitation(ctx, org, owner, "revoke@example.test", "viewer", identity.HashToken(revokeToken), time.Now().Add(7*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RevokeInvitation(ctx, org, owner, revokeInvite.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AcceptInvitation(ctx, identity.HashToken(revokeToken), "revoke@example.test", invitee); !errors.Is(err, identity.ErrInvitationNotFound) {
		t.Fatalf("revoked invitation acceptance error=%v, want not found", err)
	}
	items, err := store.ListInvitations(ctx, org, 100, 0)
	if err != nil || len(items) != 2 {
		t.Fatalf("list invitations=%d err=%v, want 2", len(items), err)
	}
}
