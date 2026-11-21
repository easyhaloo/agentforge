package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func TestIssueRepository_Update(t *testing.T) {
	// RED: This test verifies that updating issue title and body works correctly
	// Expected to FAIL because Update() method doesn't exist yet

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

	orgID := "test-org-003"

	ensureIssueTestFixtures(t, store, orgID)
	repo1 := "owner/update-test"

	// Create test issue
	now := time.Now().UTC()
	issue := &issues.Issue{
		ID:         "issue-update-001",
		Repository: repo1,
		Title:      "Original Title",
		Body:       "Original body text",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	created, err := repo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Test 1: Update title
	created.Title = "Updated Title"
	created.UpdatedAt = time.Now().UTC()

	updated, err := repo.Update(ctx, orgID, created)
	if err != nil {
		t.Fatalf("failed to update issue: %v", err)
	}

	if updated.Title != "Updated Title" {
		t.Errorf("expected title 'Updated Title', got %q", updated.Title)
	}

	// Verify via Get
	retrieved, err := repo.Get(ctx, orgID, repo1, created.Number)
	if err != nil {
		t.Fatalf("failed to retrieve issue: %v", err)
	}

	if retrieved.Title != "Updated Title" {
		t.Errorf("retrieved issue has wrong title: %q", retrieved.Title)
	}

	// Test 2: Update body
	updated.Body = "Updated body text with more details"
	updated.UpdatedAt = time.Now().UTC()

	updated, err = repo.Update(ctx, orgID, updated)
	if err != nil {
		t.Fatalf("failed to update body: %v", err)
	}

	if updated.Body != "Updated body text with more details" {
		t.Errorf("expected updated body, got %q", updated.Body)
	}

	// Test 3: UpdatedAt should change
	if !updated.UpdatedAt.After(created.CreatedAt) {
		t.Errorf("UpdatedAt should be after CreatedAt")
	}
}
