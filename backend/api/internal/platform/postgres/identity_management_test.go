package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func identityManagementOpenStore(t *testing.T) (context.Context, *Store) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Close)

	// Run migrations to ensure platform_credentials table exists
	if err := store.Migrate(ctx); err != nil {
		t.Fatalf("migration failed: %v", err)
	}

	return ctx, store
}

func insertLinkedIdentityFixture(t *testing.T, ctx context.Context, store *Store, userID, issuer, subject string) {
	t.Helper()
	id, err := newSessionID()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.pool.Exec(ctx, "INSERT INTO external_identities (id, user_id, issuer, subject) VALUES ($1, $2, $3, $4)", id, userID, issuer, subject); err != nil {
		t.Fatal(err)
	}
}

func TestListUserIdentities(t *testing.T) {
	ctx, store := identityManagementOpenStore(t)
	// Create a user with multiple identities
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "multi-"+newTestSuffix()+"@example.test", "password123", "Multi User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	googleSubject := "google-subject-123-" + newTestSuffix()
	insertLinkedIdentityFixture(t, ctx, store, userID, "https://google.com", googleSubject)

	// List identities
	identities, err := store.ListUserIdentities(ctx, userID)
	if err != nil {
		t.Fatalf("list identities: %v", err)
	}

	if len(identities) != 2 {
		t.Errorf("expected 2 identities, got %d", len(identities))
	}

	// Verify platform identity exists
	foundPlatform := false
	foundGoogle := false
	for _, id := range identities {
		if id.Issuer == "platform:internal" && id.Subject == userID {
			foundPlatform = true
		}
		if id.Issuer == "https://google.com" && id.Subject == googleSubject {
			foundGoogle = true
		}
	}
	if !foundPlatform {
		t.Error("platform identity not found")
	}
	if !foundGoogle {
		t.Error("Google identity not found")
	}
}

func TestGetUserIdentityCount(t *testing.T) {
	ctx, store := identityManagementOpenStore(t)

	// Create user with one identity
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "count-"+newTestSuffix()+"@example.test", "password123", "Count User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	count, err := store.GetUserIdentityCount(ctx, userID)
	if err != nil {
		t.Fatalf("get identity count: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 identity, got %d", count)
	}

	// Add another identity
	insertLinkedIdentityFixture(t, ctx, store, userID, "https://github.com", "gh-user-456-"+newTestSuffix())

	count, err = store.GetUserIdentityCount(ctx, userID)
	if err != nil {
		t.Fatalf("get identity count after add: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 identities, got %d", count)
	}
}

func TestDeleteUserIdentity(t *testing.T) {
	ctx, store := identityManagementOpenStore(t)

	// Create user with two identities
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "delete-"+newTestSuffix()+"@example.test", "password123", "Delete User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	insertLinkedIdentityFixture(t, ctx, store, userID, "https://github.com", "gh-delete-789-"+newTestSuffix())

	// Get identities
	identities, err := store.ListUserIdentities(ctx, userID)
	if err != nil {
		t.Fatalf("list identities: %v", err)
	}
	if len(identities) != 2 {
		t.Fatalf("expected 2 identities, got %d", len(identities))
	}

	// Find GitHub identity
	var githubIdentityID string
	for _, id := range identities {
		if id.Issuer == "https://github.com" {
			githubIdentityID = id.ID
			break
		}
	}
	if githubIdentityID == "" {
		t.Fatal("GitHub identity not found")
	}

	// Delete GitHub identity
	err = store.DeleteUserIdentity(ctx, userID, githubIdentityID)
	if err != nil {
		t.Fatalf("delete identity: %v", err)
	}

	// Verify only one identity remains
	identities, err = store.ListUserIdentities(ctx, userID)
	if err != nil {
		t.Fatalf("list identities after delete: %v", err)
	}
	if len(identities) != 1 {
		t.Errorf("expected 1 identity after delete, got %d", len(identities))
	}
	if identities[0].Issuer != "platform:internal" {
		t.Errorf("expected remaining identity to be platform, got %s", identities[0].Issuer)
	}
}

func TestDeleteUserIdentity_PlatformCredentials(t *testing.T) {
	ctx, store := identityManagementOpenStore(t)

	// Create user with platform and external identity
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "delcred-"+newTestSuffix()+"@example.test", "password123", "Del Cred User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	insertLinkedIdentityFixture(t, ctx, store, userID, "https://google.com", "google-delcred-999-"+newTestSuffix())

	// Verify platform credentials exist
	hasCreds, err := store.HasPlatformCredentials(ctx, userID)
	if err != nil {
		t.Fatalf("check platform credentials: %v", err)
	}
	if !hasCreds {
		t.Fatal("expected platform credentials to exist")
	}

	// Get identities and find platform identity
	identities, err := store.ListUserIdentities(ctx, userID)
	if err != nil {
		t.Fatalf("list identities: %v", err)
	}

	var platformIdentityID string
	for _, id := range identities {
		if id.Issuer == "platform:internal" {
			platformIdentityID = id.ID
			break
		}
	}
	if platformIdentityID == "" {
		t.Fatal("platform identity not found")
	}

	// Delete platform identity (should also delete platform_credentials)
	err = store.DeleteUserIdentity(ctx, userID, platformIdentityID)
	if err != nil {
		t.Fatalf("delete platform identity: %v", err)
	}

	// Verify platform credentials are deleted
	hasCreds, err = store.HasPlatformCredentials(ctx, userID)
	if err != nil {
		t.Fatalf("check platform credentials after delete: %v", err)
	}
	if hasCreds {
		t.Error("expected platform credentials to be deleted")
	}

	// Verify user still has Google identity
	identities, err = store.ListUserIdentities(ctx, userID)
	if err != nil {
		t.Fatalf("list identities after delete: %v", err)
	}
	if len(identities) != 1 {
		t.Fatalf("expected 1 identity after delete, got %d", len(identities))
	}
	if identities[0].Issuer != "https://google.com" {
		t.Errorf("expected remaining identity to be Google, got %s", identities[0].Issuer)
	}
}

func TestDeleteUserIdentity_WrongUser(t *testing.T) {
	ctx, store := identityManagementOpenStore(t)

	// Create two users
	userID1, _, err := store.CreateOrUpdateLocalUser(ctx, "user1@example.test", "password123", "User 1")
	if err != nil {
		t.Fatalf("create user1: %v", err)
	}

	userID2, _, err := store.CreateOrUpdateLocalUser(ctx, "user2@example.test", "password123", "User 2")
	if err != nil {
		t.Fatalf("create user2: %v", err)
	}

	// Get user1's identity
	identities, err := store.ListUserIdentities(ctx, userID1)
	if err != nil {
		t.Fatalf("list identities: %v", err)
	}
	if len(identities) == 0 {
		t.Fatal("expected at least one identity")
	}

	// Try to delete user1's identity as user2 (should fail)
	err = store.DeleteUserIdentity(ctx, userID2, identities[0].ID)
	if err != identity.ErrUnauthenticated {
		t.Errorf("expected ErrUnauthenticated, got %v", err)
	}
}

func TestChangeUserPassword(t *testing.T) {
	ctx, store := identityManagementOpenStore(t)

	// Create user
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "changepw@example.test", "oldpassword", "Change PW User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	// Change password
	err = store.ChangeUserPassword(ctx, userID, "oldpassword", "newpassword")
	if err != nil {
		t.Fatalf("change password: %v", err)
	}

	// Verify old password no longer works
	user, err := store.FindUserByEmail(ctx, "changepw@example.test")
	if err != nil {
		t.Fatalf("find user: %v", err)
	}

	err = identity.VerifyPassword(user.PasswordHash, "oldpassword")
	if err != identity.ErrUnauthenticated {
		t.Error("expected old password to fail verification")
	}

	// Verify new password works
	err = identity.VerifyPassword(user.PasswordHash, "newpassword")
	if err != nil {
		t.Errorf("new password should verify: %v", err)
	}
}

func TestChangeUserPassword_WrongCurrentPassword(t *testing.T) {
	ctx, store := identityManagementOpenStore(t)

	// Create user
	userID, _, err := store.CreateOrUpdateLocalUser(ctx, "wrongpw@example.test", "correctpassword", "Wrong PW User")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	// Try to change password with wrong current password
	err = store.ChangeUserPassword(ctx, userID, "wrongpassword", "newpassword")
	if err != identity.ErrUnauthenticated {
		t.Errorf("expected ErrUnauthenticated, got %v", err)
	}

	// Verify original password still works
	user, err := store.FindUserByEmail(ctx, "wrongpw@example.test")
	if err != nil {
		t.Fatalf("find user: %v", err)
	}

	err = identity.VerifyPassword(user.PasswordHash, "correctpassword")
	if err != nil {
		t.Error("original password should still work after failed change attempt")
	}
}

func TestChangeUserPassword_NoPlatformCredentials(t *testing.T) {
	ctx, store := identityManagementOpenStore(t)

	// Create user with only OIDC identity (no platform credentials)
	userID, err := store.UpsertExternalIdentity(ctx, "https://google.com", "google-nopw-111", "nopw@example.test", "No PW User")
	if err != nil {
		t.Fatalf("create OIDC user: %v", err)
	}

	// Try to change password (should fail - no platform credentials)
	err = store.ChangeUserPassword(ctx, userID, "oldpassword", "newpassword")
	if err == nil {
		t.Error("expected error when changing password for user without platform credentials")
	}
}

func TestHasPlatformCredentials(t *testing.T) {
	ctx, store := identityManagementOpenStore(t)

	// User with platform credentials
	userID1, _, err := store.CreateOrUpdateLocalUser(ctx, "hascreds@example.test", "password123", "Has Creds")
	if err != nil {
		t.Fatalf("create user with credentials: %v", err)
	}

	hasCreds, err := store.HasPlatformCredentials(ctx, userID1)
	if err != nil {
		t.Fatalf("check credentials: %v", err)
	}
	if !hasCreds {
		t.Error("expected user to have platform credentials")
	}

	// User without platform credentials (OIDC only)
	userID2, err := store.UpsertExternalIdentity(ctx, "https://github.com", "gh-nocreds-222", "nocreds@example.test", "No Creds")
	if err != nil {
		t.Fatalf("create OIDC user: %v", err)
	}

	hasCreds, err = store.HasPlatformCredentials(ctx, userID2)
	if err != nil {
		t.Fatalf("check credentials for OIDC user: %v", err)
	}
	if hasCreds {
		t.Error("expected OIDC-only user to not have platform credentials")
	}
}
