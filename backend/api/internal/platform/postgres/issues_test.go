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
