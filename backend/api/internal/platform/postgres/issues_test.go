package postgres

import (
	"context"
	"os"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func TestIssueRepository_CreateAssignsSequentialNumbers(t *testing.T) {
	// RED: This test verifies that creating issues automatically assigns
	// sequential numbers starting from 1, independently per repository
	// Expected to FAIL because IssueRepository is not implemented yet

	ctx := context.Background()

	// Get test database URL or skip
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set, skipping integration test")
	}

	// Open store
	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("failed to open store: %v", err)
	}
	defer store.Close()

	// Create IssueRepository (this doesn't exist yet - will fail to compile)
	repo := NewIssueRepository(store)

	orgID := "test-org-001"

	ensureIssueTestFixtures(t, store, orgID)
	repoA := "owner/repo-a"
	repoB := "owner/repo-b"

	// Test 1: First issue in repo-a should be #1
	issue1 := &issues.Issue{
		ID:         "issue-001",
		Repository: repoA,
		Title:      "First issue",
		Body:       "This is the first issue",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
	}

	created1, err := repo.Create(ctx, orgID, issue1)
	if err != nil {
		t.Fatalf("failed to create first issue: %v", err)
	}

	if created1.Number != 1 {
		t.Errorf("expected first issue to have number 1, got %d", created1.Number)
	}

	// Test 2: Second issue in repo-a should be #2
	issue2 := &issues.Issue{
		ID:         "issue-002",
		Repository: repoA,
		Title:      "Second issue",
		Body:       "This is the second issue",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
	}

	created2, err := repo.Create(ctx, orgID, issue2)
	if err != nil {
		t.Fatalf("failed to create second issue: %v", err)
	}

	if created2.Number != 2 {
		t.Errorf("expected second issue to have number 2, got %d", created2.Number)
	}

	// Test 3: First issue in repo-b should be #1 (independent numbering)
	issue3 := &issues.Issue{
		ID:         "issue-003",
		Repository: repoB,
		Title:      "First issue in repo B",
		Body:       "Different repository",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
	}

	created3, err := repo.Create(ctx, orgID, issue3)
	if err != nil {
		t.Fatalf("failed to create issue in repo-b: %v", err)
	}

	if created3.Number != 1 {
		t.Errorf("expected first issue in repo-b to have number 1, got %d", created3.Number)
	}

	// Test 4: Verify we can retrieve issues by repository + number
	retrieved, err := repo.Get(ctx, orgID, repoA, 1)
	if err != nil {
		t.Fatalf("failed to retrieve issue: %v", err)
	}

	if retrieved.ID != issue1.ID {
		t.Errorf("expected to retrieve issue %s, got %s", issue1.ID, retrieved.ID)
	}

	if retrieved.Title != issue1.Title {
		t.Errorf("expected title %q, got %q", issue1.Title, retrieved.Title)
	}
}

func TestIssueRepository_LockAndUnlock(t *testing.T) {
	// Test that locking and unlocking issues works correctly
	ctx := context.Background()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set, skipping integration test")
	}

	store, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("failed to open store: %v", err)
	}
	defer store.Close()

	repo := NewIssueRepository(store)
	orgID := "test-org-lock"
	ensureIssueTestFixtures(t, store, orgID)
	repository := "owner/test-repo"

	// Create a test issue
	issue := &issues.Issue{
		ID:         "issue-lock-test",
		Repository: repository,
		Title:      "Test locking",
		Body:       "This issue will be locked",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
	}

	created, err := repo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Verify issue starts unlocked
	if created.Locked {
		t.Errorf("new issue should not be locked")
	}

	// Test 1: Lock the issue
	lockReason := issues.LockReasonTooHeated
	lockedBy := "admin-001"
	// Use microsecond precision since PostgreSQL timestamptz truncates to microseconds
	lockedAt := created.CreatedAt.Add(3600 * time.Microsecond)

	locked, err := repo.Lock(ctx, orgID, created.ID, lockReason, lockedBy, lockedAt)
	if err != nil {
		t.Fatalf("failed to lock issue: %v", err)
	}

	if !locked.Locked {
		t.Errorf("issue should be locked")
	}
	if locked.LockReason != lockReason {
		t.Errorf("expected lock reason %q, got %q", lockReason, locked.LockReason)
	}
	if locked.LockedBy != lockedBy {
		t.Errorf("expected locked by %q, got %q", lockedBy, locked.LockedBy)
	}
	if locked.LockedAt == nil {
		t.Errorf("locked_at should not be nil")
	} else if !locked.LockedAt.Equal(lockedAt) {
		t.Errorf("expected locked_at %v, got %v", lockedAt, *locked.LockedAt)
	}

	// Test 2: Retrieve locked issue and verify lock fields persist
	retrieved, err := repo.Get(ctx, orgID, repository, created.Number)
	if err != nil {
		t.Fatalf("failed to retrieve locked issue: %v", err)
	}

	if !retrieved.Locked {
		t.Errorf("retrieved issue should be locked")
	}
	if retrieved.LockReason != lockReason {
		t.Errorf("retrieved issue lock reason mismatch")
	}
	if retrieved.LockedBy != lockedBy {
		t.Errorf("retrieved issue locked_by mismatch")
	}

	// Test 3: Unlock the issue
	unlocked, err := repo.Unlock(ctx, orgID, created.ID)
	if err != nil {
		t.Fatalf("failed to unlock issue: %v", err)
	}

	if unlocked.Locked {
		t.Errorf("issue should be unlocked")
	}
	if unlocked.LockReason != "" {
		t.Errorf("lock reason should be empty after unlock, got %q", unlocked.LockReason)
	}
	if unlocked.LockedBy != "" {
		t.Errorf("locked_by should be empty after unlock, got %q", unlocked.LockedBy)
	}
	if unlocked.LockedAt != nil {
		t.Errorf("locked_at should be nil after unlock, got %v", *unlocked.LockedAt)
	}

	// Test 4: Verify unlocked state persists
	retrievedUnlocked, err := repo.Get(ctx, orgID, repository, created.Number)
	if err != nil {
		t.Fatalf("failed to retrieve unlocked issue: %v", err)
	}

	if retrievedUnlocked.Locked {
		t.Errorf("retrieved issue should be unlocked")
	}
}
