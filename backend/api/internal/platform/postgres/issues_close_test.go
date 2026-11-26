package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func TestIssueRepository_Close(t *testing.T) {
	// RED: This test verifies that closing issues works with state_reason
	// Expected to FAIL because Close() method doesn't exist yet

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

	orgID := "test-org-004-" + newTestSuffix()

	ensureIssueTestFixtures(t, store, orgID)
	repo1 := "owner/close-test"

	// Create test issue
	now := time.Now().UTC()
	issue := &issues.Issue{
		ID:         issues.ID("issue-close-001-" + newTestSuffix()),
		Repository: repo1,
		Title:      "Issue to close",
		Body:       "This will be closed",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	created, err := repo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	if created.State != issues.StateOpen {
		t.Errorf("new issue should be open, got %s", created.State)
	}

	// Test 1: Close with 'completed' reason
	closedAt := time.Now().UTC()
	closed, err := repo.Close(ctx, orgID, created.ID, issues.ReasonCompleted, "user-002", closedAt)
	if err != nil {
		t.Fatalf("failed to close issue: %v", err)
	}

	if closed.State != issues.StateClosed {
		t.Errorf("expected state closed, got %s", closed.State)
	}

	if closed.StateReason != issues.ReasonCompleted {
		t.Errorf("expected reason completed, got %s", closed.StateReason)
	}

	if closed.ClosedBy != "user-002" {
		t.Errorf("expected closed_by user-002, got %s", closed.ClosedBy)
	}

	if closed.ClosedAt == nil {
		t.Error("expected closed_at to be set")
	}

	// Test 2: Verify via Get
	retrieved, err := repo.Get(ctx, orgID, repo1, created.Number)
	if err != nil {
		t.Fatalf("failed to retrieve issue: %v", err)
	}

	if retrieved.State != issues.StateClosed {
		t.Errorf("retrieved issue should be closed, got %s", retrieved.State)
	}

	if retrieved.StateReason != issues.ReasonCompleted {
		t.Errorf("retrieved issue should have reason completed, got %s", retrieved.StateReason)
	}

	// Test 3: Close another issue with 'not_planned' reason
	issue2 := &issues.Issue{
		ID:         issues.ID("issue-close-002-" + newTestSuffix()),
		Repository: repo1,
		Title:      "Won't fix",
		Body:       "This will be closed as not planned",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	created2, err := repo.Create(ctx, orgID, issue2)
	if err != nil {
		t.Fatalf("failed to create second issue: %v", err)
	}

	closed2, err := repo.Close(ctx, orgID, created2.ID, issues.ReasonNotPlanned, "user-001", time.Now().UTC())
	if err != nil {
		t.Fatalf("failed to close with not_planned: %v", err)
	}

	if closed2.StateReason != issues.ReasonNotPlanned {
		t.Errorf("expected reason not_planned, got %s", closed2.StateReason)
	}
}
