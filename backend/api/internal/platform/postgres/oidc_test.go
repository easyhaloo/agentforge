package postgres

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"sync"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func TestPostgresOIDCTransactionsAreSingleUseAndExternalIdentityIsStable(t *testing.T) {
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

	state, err := identity.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	nonce, err := identity.GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	stateHash, nonceHash := identity.HashToken(state), identity.HashToken(nonce)
	if err := store.CreateOIDCAuthTransaction(ctx, stateHash, nonceHash, time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	gotNonceHash, err := store.ConsumeOIDCAuthTransaction(ctx, stateHash)
	if err != nil || gotNonceHash != nonceHash {
		t.Fatalf("consume nonce hash=%q err=%v", gotNonceHash, err)
	}
	if _, err := store.ConsumeOIDCAuthTransaction(ctx, stateHash); !errors.Is(err, identity.ErrUnauthenticated) {
		t.Fatalf("replayed transaction error=%v, want ErrUnauthenticated", err)
	}

	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	issuer := "https://issuer.example.test/" + suffix
	subject := "oidc-subject-" + suffix
	userID, err := store.UpsertExternalIdentity(ctx, issuer, subject, "verified@example.test", "First Name")
	if err != nil {
		t.Fatal(err)
	}
	sameUserID, err := store.UpsertExternalIdentity(ctx, issuer, subject, "verified@example.test", "Updated Name")
	if err != nil {
		t.Fatal(err)
	}
	if sameUserID != userID {
		t.Fatalf("external identity changed local user: first=%q second=%q", userID, sameUserID)
	}
	var name, email string
	if err := store.pool.QueryRow(ctx, "SELECT display_name, email FROM users WHERE id = $1", userID).Scan(&name, &email); err != nil {
		t.Fatal(err)
	}
	if name != "Updated Name" || email != "verified@example.test" {
		t.Fatalf("updated profile name=%q email=%q", name, email)
	}

	otherUserID, err := store.UpsertExternalIdentity(ctx, issuer, subject+"-other", "verified@example.test", "Other Person")
	if err != nil {
		t.Fatal(err)
	}
	if otherUserID == userID {
		t.Fatal("distinct issuer/subject identity must not be merged by email")
	}
}

func TestBootstrapFirstOwnerIsSerializedAndOneTime(t *testing.T) {
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
	organizationID := "bootstrap-org-" + suffix
	issuer := "https://bootstrap-issuer.example.test"
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, subject := range []string{"owner-a-" + suffix, "owner-b-" + suffix} {
		wait.Add(1)
		go func(subject string) {
			defer wait.Done()
			_, err := store.BootstrapFirstOwner(ctx, issuer, subject, organizationID, "Bootstrap Organization", "bootstrap-"+suffix)
			results <- err
		}(subject)
	}
	wait.Wait()
	close(results)

	successes, rejected := 0, 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrOwnerAlreadyExists):
			rejected++
		default:
			t.Fatalf("unexpected bootstrap error: %v", err)
		}
	}
	if successes != 1 || rejected != 1 {
		t.Fatalf("bootstrap successes=%d rejected=%d, want one each", successes, rejected)
	}

	var ownerCount int
	if err := store.pool.QueryRow(ctx, "SELECT count(*) FROM organization_memberships WHERE organization_id = $1 AND role = 'owner'", organizationID).Scan(&ownerCount); err != nil {
		t.Fatal(err)
	}
	if ownerCount != 1 {
		t.Fatalf("owner count=%d, want 1", ownerCount)
	}

	if _, err := store.BootstrapFirstOwner(ctx, issuer, "late-owner-"+suffix, organizationID, "Bootstrap Organization", "bootstrap-"+suffix); !errors.Is(err, ErrOwnerAlreadyExists) {
		t.Fatalf("repeat bootstrap error=%v, want ErrOwnerAlreadyExists", err)
	}
}

func TestBootstrapFirstOwnerRejectsSuspendedOrganization(t *testing.T) {
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

	organizationID := "bootstrap-suspended-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if _, err := store.pool.Exec(ctx, "INSERT INTO organizations (id, name, status) VALUES ($1, $1, 'suspended')", organizationID); err != nil {
		t.Fatal(err)
	}
	_, err = store.BootstrapFirstOwner(ctx, "https://bootstrap-issuer.example.test", "suspended-owner", organizationID, "Suspended", "bootstrap-suspended")
	if !errors.Is(err, ErrOrganizationInactive) {
		t.Fatalf("suspended organization bootstrap error=%v, want ErrOrganizationInactive", err)
	}
}
