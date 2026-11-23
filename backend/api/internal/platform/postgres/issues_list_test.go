package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func TestIssueRepository_List(t *testing.T) {
	// RED: This test verifies that listing issues supports pagination and filtering
	// Expected to FAIL because List() method doesn't exist yet

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

	orgID := "test-org-002"

	ensureIssueTestFixtures(t, store, orgID)
	repo1 := "owner/test-repo"

	// Create test issues
	now := time.Now().UTC()
	closedAt := now.Add(2 * time.Minute)
	testIssues := []*issues.Issue{
		{
			ID:         "issue-list-001",
			Repository: repo1,
			Title:      "First issue",
			Body:       "Body 1",
			State:      issues.StateOpen,
			CreatedBy:  "user-001",
			CreatedAt:  now,
			UpdatedAt:  now,
		},
		{
			ID:         "issue-list-002",
			Repository: repo1,
			Title:      "Second issue",
			Body:       "Body 2",
			State:      issues.StateOpen,
			CreatedBy:  "user-002",
			CreatedAt:  now.Add(1 * time.Minute),
			UpdatedAt:  now.Add(1 * time.Minute),
		},
		{
			ID:         "issue-list-003",
			Repository: repo1,
			Title:      "Third issue",
			Body:       "Body 3",
			State:      issues.StateOpen,
			CreatedBy:  "user-001",
			CreatedAt:  now,
			UpdatedAt:  now,
		},
	}

	for _, issue := range testIssues {
		_, err := repo.Create(ctx, orgID, issue)
		if err != nil {
			t.Fatalf("failed to create test issue: %v", err)
		}
	}

	// Close the third issue
	_, err = repo.Close(ctx, orgID, "issue-list-003", issues.ReasonCompleted, "user-001", closedAt)
	if err != nil {
		t.Fatalf("failed to close issue: %v", err)
	}

	// Test 1: List all issues (no filter)
	filter := issues.ListFilter{}
	result, total, err := repo.List(ctx, orgID, filter, 10, 0)
	if err != nil {
		t.Fatalf("failed to list issues: %v", err)
	}

	if total.Total != 3 {
		t.Errorf("expected total 3, got %d", total.Total)
	}

	if len(result) != 3 {
		t.Errorf("expected 3 issues, got %d", len(result))
	}

	// Test 2: Filter by state (open only)
	filter = issues.ListFilter{State: issues.StateOpen}
	result, total, err = repo.List(ctx, orgID, filter, 10, 0)
	if err != nil {
		t.Fatalf("failed to list open issues: %v", err)
	}

	if total.Total != 2 {
		t.Errorf("expected 2 open issues, got %d", total.Total)
	}

	// Test 3: Filter by creator
	filter = issues.ListFilter{CreatedBy: "user-001"}
	result, total, err = repo.List(ctx, orgID, filter, 10, 0)
	if err != nil {
		t.Fatalf("failed to list issues by creator: %v", err)
	}

	if total.Total != 2 {
		t.Errorf("expected 2 issues by user-001, got %d", total.Total)
	}

	// Test 4: Pagination (limit 2, offset 1)
	filter = issues.ListFilter{}
	result, total, err = repo.List(ctx, orgID, filter, 2, 1)
	if err != nil {
		t.Fatalf("failed to list with pagination: %v", err)
	}

	if total.Total != 3 {
		t.Errorf("expected total 3, got %d", total.Total)
	}

	if len(result) != 2 {
		t.Errorf("expected 2 issues (limit), got %d", len(result))
	}

	// Test 5: Search by title/body
	filter = issues.ListFilter{Query: "First"}
	result, total, err = repo.List(ctx, orgID, filter, 10, 0)
	if err != nil {
		t.Fatalf("failed to search issues: %v", err)
	}

	if total.Total != 1 {
		t.Errorf("expected 1 issue matching 'First', got %d", total.Total)
	}

	if len(result) > 0 && result[0].Title != "First issue" {
		t.Errorf("expected 'First issue', got %q", result[0].Title)
	}
}
