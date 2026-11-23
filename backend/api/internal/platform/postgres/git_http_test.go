package postgres

import (
	"crypto/sha256"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func TestGitCredentialRepositoryAndLiveAuthorization(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := t.Context()
	store, err := Open(ctx, slugScratchDatabase(t, dsn, 1))
	lockMust(t, err)
	t.Cleanup(store.Close)
	fixture := &lockFixture{ctx: ctx, store: store}
	const repo, otherRepo = "imported/repo", "imported/other"
	owner := newLockHTTP(t, fixture, 0, repo, otherRepo)
	outsider := newLockHTTP(t, fixture, 0, repo)
	org, user := owner.organizationID, owner.userID

	create := func(id, scope string, expires time.Time) [32]byte {
		t.Helper()
		hash := sha256.Sum256([]byte(id))
		lockMust(t, store.CreateGitCredential(ctx, id, org, repo, user, scope, hash[:], expires))
		return hash
	}
	verify := func(hash [32]byte, organization, repository string, write, allowed bool) {
		t.Helper()
		gotOrg, gotUser, _, err := store.AuthorizeGitCredential(ctx, hash[:], organization, repository, write)
		if allowed {
			if err != nil || gotOrg != org || gotUser != user {
				t.Fatalf("authorize (%s, %s, write=%t) = (%q, %q, %v)", organization, repository, write, gotOrg, gotUser, err)
			}
		} else if !errors.Is(err, identity.ErrUnauthenticated) {
			t.Fatalf("authorize (%s, %s, write=%t) error = %v, want unauthenticated", organization, repository, write, err)
		}
	}
	setMembership := func(role, status string) {
		t.Helper()
		_, err := store.pool.Exec(ctx, `UPDATE organization_memberships SET role = $3, status = $4
			WHERE organization_id = $1 AND user_id = $2`, org, user, role, status)
		lockMust(t, err)
	}

	expires := time.Now().Add(time.Hour)
	write := create("fixture-write", "write", expires)
	read := create("fixture-read", "read", expires)
	expired := create("fixture-expired", "write", time.Now().Add(-time.Hour))
	verify(write, org, repo, true, true)
	verify(write, org, repo, false, true)
	verify(read, org, repo, false, true)
	verify(read, org, repo, true, false)
	verify(expired, org, repo, false, false)
	verify(write, org, otherRepo, true, false)
	verify(write, outsider.organizationID, repo, true, false)
	lockMust(t, store.RevokeGitCredential(ctx, "fixture-write", org, repo, outsider.userID))
	verify(write, org, repo, true, true)

	setMembership("viewer", "active")
	verify(write, org, repo, true, false)
	verify(write, org, repo, false, true)
	hash := sha256.Sum256([]byte("viewer-write"))
	if err := store.CreateGitCredential(ctx, "viewer-write", org, repo, user, "write", hash[:], expires); !errors.Is(err, identity.ErrUnauthenticated) {
		t.Fatalf("viewer write credential error = %v, want unauthenticated", err)
	}
	setMembership("member", "suspended")
	verify(write, org, repo, false, false)
	setMembership("member", "active")
	verify(write, org, repo, true, true)
	lockMust(t, store.RevokeGitCredential(ctx, "fixture-write", org, repo, user))
	verify(write, org, repo, false, false)
}
