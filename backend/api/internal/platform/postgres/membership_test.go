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

func TestPostgresInvitationRequiresVerifiedMatchingEmail(t *testing.T) {
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
	issuer := "https://membership-issuer.example.test"
	ownerSubject := "membership-owner-" + suffix
	memberSubject := "membership-member-" + suffix
	ownerID, err := store.UpsertExternalIdentity(ctx, issuer, ownerSubject, "owner@example.test", "Owner")
	if err != nil {
		t.Fatal(err)
	}
	memberID, err := store.UpsertExternalIdentity(ctx, issuer, memberSubject, "member@example.test", "Member")
	if err != nil {
		t.Fatal(err)
	}
	organizationID := "membership-org-" + suffix
	if _, err := store.BootstrapFirstOwner(ctx, issuer, ownerSubject, organizationID, "Membership Organization"); err != nil {
		t.Fatal(err)
	}
	_ = ownerID

	ownerCredentials, err := identity.GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(ctx, ownerID, ownerCredentials.SessionToken, ownerCredentials.CSRFToken, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	inviteToken, err := identity.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	invitation, err := store.CreateInvitation(ctx, organizationID, ownerID, "owner", "member@example.test", "member", identity.HashToken(inviteToken), time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if invitation.Email != "member@example.test" || invitation.Role != "member" {
		t.Fatalf("invitation=%#v", invitation)
	}

	unverifiedUserID, err := store.UpsertExternalIdentity(ctx, issuer, "unverified-"+suffix, "", "Unverified")
	if err != nil {
		t.Fatal(err)
	}
	unverifiedCredentials, err := identity.GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(ctx, unverifiedUserID, unverifiedCredentials.SessionToken, unverifiedCredentials.CSRFToken, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AcceptInvitation(ctx, unverifiedCredentials.SessionToken, inviteToken); !errors.Is(err, identity.ErrInvitationEmailMismatch) {
		t.Fatalf("unverified email acceptance error=%v", err)
	}

	memberCredentials, err := identity.GenerateCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateSession(ctx, memberID, memberCredentials.SessionToken, memberCredentials.CSRFToken, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	acceptedOrganization, err := store.AcceptInvitation(ctx, memberCredentials.SessionToken, inviteToken)
	if err != nil {
		t.Fatal(err)
	}
	if acceptedOrganization != organizationID {
		t.Fatalf("accepted organization=%q want %q", acceptedOrganization, organizationID)
	}
	if _, err := store.AcceptInvitation(ctx, memberCredentials.SessionToken, inviteToken); !errors.Is(err, identity.ErrInvitationNotFound) {
		t.Fatalf("replayed invitation error=%v want ErrInvitationNotFound", err)
	}

	members, err := store.ListMembers(ctx, organizationID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, member := range members {
		if member.UserID == memberID && member.Role == "member" && member.Status == "active" && member.Email == "member@example.test" {
			found = true
		}
	}
	if !found {
		t.Fatal("accepted member with verified email was not listed")
	}
}
