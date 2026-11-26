package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func TestIssueRepository_AddAssignee(t *testing.T) {
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

	issueRepo := NewIssueRepository(store)
	orgID := "test-org-assignees-001-" + newTestSuffix()
	ensureIssueTestFixtures(t, store, orgID)
	repoName := "owner/assignee-test"

	// Create an issue first
	issue := &issues.Issue{
		ID:         issues.ID("issue-assignee-001-" + newTestSuffix()),
		Repository: repoName,
		Title:      "Test issue for assignees",
		Body:       "Testing assignee functionality",
		State:      issues.StateOpen,
		CreatedBy:  "user-creator",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}

	_, err = issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Add assignee
	assigneeID := "user-assignee-001"
	err = issueRepo.AddAssignee(ctx, orgID, string(issue.ID), assigneeID)
	if err != nil {
		t.Fatalf("failed to add assignee: %v", err)
	}

	// Verify assignee was added
	assignees, err := issueRepo.GetAssignees(ctx, orgID, string(issue.ID))
	if err != nil {
		t.Fatalf("failed to get assignees: %v", err)
	}

	if len(assignees) != 1 {
		t.Fatalf("expected 1 assignee, got %d", len(assignees))
	}

	if assignees[0] != assigneeID {
		t.Errorf("expected assignee %s, got %s", assigneeID, assignees[0])
	}
}

func TestIssueRepository_AddMultipleAssignees(t *testing.T) {
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

	issueRepo := NewIssueRepository(store)
	orgID := "test-org-assignees-002-" + newTestSuffix()
	ensureIssueTestFixtures(t, store, orgID)
	repoName := "owner/multi-assignee-test"

	// Create an issue
	issue := &issues.Issue{
		ID:         issues.ID("issue-multi-assignee-001-" + newTestSuffix()),
		Repository: repoName,
		Title:      "Test issue for multiple assignees",
		Body:       "Testing multiple assignee functionality",
		State:      issues.StateOpen,
		CreatedBy:  "user-creator",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}

	_, err = issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Add multiple assignees
	assigneeIDs := []string{"user-001", "user-002", "user-003"}
	for _, assigneeID := range assigneeIDs {
		err = issueRepo.AddAssignee(ctx, orgID, string(issue.ID), assigneeID)
		if err != nil {
			t.Fatalf("failed to add assignee %s: %v", assigneeID, err)
		}
	}

	// Verify all assignees were added
	assignees, err := issueRepo.GetAssignees(ctx, orgID, string(issue.ID))
	if err != nil {
		t.Fatalf("failed to get assignees: %v", err)
	}

	if len(assignees) != 3 {
		t.Fatalf("expected 3 assignees, got %d", len(assignees))
	}

	// Verify all expected assignees are present
	assigneeMap := make(map[string]bool)
	for _, a := range assignees {
		assigneeMap[a] = true
	}

	for _, expected := range assigneeIDs {
		if !assigneeMap[expected] {
			t.Errorf("expected assignee %s not found", expected)
		}
	}
}

func TestIssueRepository_AddAssigneeIdempotent(t *testing.T) {
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

	issueRepo := NewIssueRepository(store)
	orgID := "test-org-assignees-003-" + newTestSuffix()
	ensureIssueTestFixtures(t, store, orgID)
	repoName := "owner/idempotent-test"

	// Create an issue
	issue := &issues.Issue{
		ID:         issues.ID("issue-idempotent-001-" + newTestSuffix()),
		Repository: repoName,
		Title:      "Test issue for idempotent assignee",
		Body:       "Testing idempotent assignee functionality",
		State:      issues.StateOpen,
		CreatedBy:  "user-creator",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}

	_, err = issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	assigneeID := "user-duplicate"

	// Add assignee first time
	err = issueRepo.AddAssignee(ctx, orgID, string(issue.ID), assigneeID)
	if err != nil {
		t.Fatalf("failed to add assignee first time: %v", err)
	}

	// Add same assignee again - should not error (idempotent)
	err = issueRepo.AddAssignee(ctx, orgID, string(issue.ID), assigneeID)
	if err != nil {
		t.Fatalf("expected no error when adding duplicate assignee, got %v", err)
	}

	// Verify only one assignee exists
	assignees, err := issueRepo.GetAssignees(ctx, orgID, string(issue.ID))
	if err != nil {
		t.Fatalf("failed to get assignees: %v", err)
	}

	if len(assignees) != 1 {
		t.Errorf("expected 1 assignee after duplicate add, got %d", len(assignees))
	}
}

func TestIssueRepository_RemoveAssignee(t *testing.T) {
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

	issueRepo := NewIssueRepository(store)
	orgID := "test-org-assignees-004-" + newTestSuffix()
	ensureIssueTestFixtures(t, store, orgID)
	repoName := "owner/remove-assignee-test"

	// Create an issue
	issue := &issues.Issue{
		ID:         issues.ID("issue-remove-assignee-001-" + newTestSuffix()),
		Repository: repoName,
		Title:      "Test issue for removing assignee",
		Body:       "Testing remove assignee functionality",
		State:      issues.StateOpen,
		CreatedBy:  "user-creator",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}

	_, err = issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	assigneeID := "user-remove"

	// Add assignee
	err = issueRepo.AddAssignee(ctx, orgID, string(issue.ID), assigneeID)
	if err != nil {
		t.Fatalf("failed to add assignee: %v", err)
	}

	// Remove assignee
	err = issueRepo.RemoveAssignee(ctx, orgID, string(issue.ID), assigneeID)
	if err != nil {
		t.Fatalf("failed to remove assignee: %v", err)
	}

	// Verify assignee was removed
	assignees, err := issueRepo.GetAssignees(ctx, orgID, string(issue.ID))
	if err != nil {
		t.Fatalf("failed to get assignees: %v", err)
	}

	if len(assignees) != 0 {
		t.Errorf("expected 0 assignees after removal, got %d", len(assignees))
	}
}

func TestIssueRepository_RemoveOneOfMultipleAssignees(t *testing.T) {
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

	issueRepo := NewIssueRepository(store)
	orgID := "test-org-assignees-005-" + newTestSuffix()
	ensureIssueTestFixtures(t, store, orgID)
	repoName := "owner/remove-one-test"

	// Create an issue
	issue := &issues.Issue{
		ID:         issues.ID("issue-remove-one-001-" + newTestSuffix()),
		Repository: repoName,
		Title:      "Test issue for removing one assignee",
		Body:       "Testing remove one of multiple assignees",
		State:      issues.StateOpen,
		CreatedBy:  "user-creator",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}

	_, err = issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Add three assignees
	assigneeIDs := []string{"user-keep-1", "user-remove", "user-keep-2"}
	for _, assigneeID := range assigneeIDs {
		err = issueRepo.AddAssignee(ctx, orgID, string(issue.ID), assigneeID)
		if err != nil {
			t.Fatalf("failed to add assignee %s: %v", assigneeID, err)
		}
	}

	// Remove one assignee
	err = issueRepo.RemoveAssignee(ctx, orgID, string(issue.ID), "user-remove")
	if err != nil {
		t.Fatalf("failed to remove assignee: %v", err)
	}

	// Verify only two assignees remain
	assignees, err := issueRepo.GetAssignees(ctx, orgID, string(issue.ID))
	if err != nil {
		t.Fatalf("failed to get assignees: %v", err)
	}

	if len(assignees) != 2 {
		t.Fatalf("expected 2 assignees after removal, got %d", len(assignees))
	}

	// Verify the removed assignee is not present
	for _, a := range assignees {
		if a == "user-remove" {
			t.Error("removed assignee still present")
		}
	}
}

func TestIssueRepository_GetAssigneesForEmptyIssue(t *testing.T) {
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

	issueRepo := NewIssueRepository(store)
	orgID := "test-org-assignees-006-" + newTestSuffix()
	ensureIssueTestFixtures(t, store, orgID)
	repoName := "owner/empty-assignee-test"

	// Create an issue
	issue := &issues.Issue{
		ID:         issues.ID("issue-empty-assignee-001-" + newTestSuffix()),
		Repository: repoName,
		Title:      "Test issue with no assignees",
		Body:       "Testing empty assignee list",
		State:      issues.StateOpen,
		CreatedBy:  "user-creator",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}

	_, err = issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Get assignees for issue with no assignees
	assignees, err := issueRepo.GetAssignees(ctx, orgID, string(issue.ID))
	if err != nil {
		t.Fatalf("failed to get assignees: %v", err)
	}

	if len(assignees) != 0 {
		t.Errorf("expected 0 assignees for new issue, got %d", len(assignees))
	}
}
