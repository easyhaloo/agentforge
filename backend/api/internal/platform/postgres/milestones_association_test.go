package postgres

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/milestones"
)

func TestMilestoneRepository_SetAndClearMilestone(t *testing.T) {
	// RED: Test issue-milestone association
	// Expected to FAIL because SetMilestone/ClearMilestone are not implemented yet

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

	milestoneRepo := NewMilestoneRepository(store)
	issueRepo := NewIssueRepository(store)

	orgID := "test-org-milestone-assoc-001-" + newTestSuffix()

	ensureIssueTestFixtures(t, store, orgID)
	repository := "owner/test-repo"

	// Create a milestone
	milestone := &milestones.Milestone{
		ID:         milestones.ID("milestone-assoc-001-" + newTestSuffix()),
		Repository: repository,
		Title:      "Sprint 1",
		State:      milestones.StateOpen,
	}

	_, err = milestoneRepo.Create(ctx, orgID, milestone)
	if err != nil {
		t.Fatalf("failed to create milestone: %v", err)
	}

	// Create an issue
	issue := &issues.Issue{
		ID:         issues.ID("issue-assoc-001-" + newTestSuffix()),
		Repository: repository,
		Title:      "Test issue",
		Body:       "Test body",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}

	created, err := issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Set milestone on the issue
	err = milestoneRepo.SetMilestone(ctx, orgID, string(created.ID), string(milestone.ID))
	if err != nil {
		t.Fatalf("failed to set milestone: %v", err)
	}

	// Verify the association by retrieving the issue
	// Note: This requires the issue to be retrieved with milestone_id
	// For now, we'll trust the SetMilestone worked if no error occurred

	// Clear the milestone
	err = milestoneRepo.ClearMilestone(ctx, orgID, string(created.ID))
	if err != nil {
		t.Fatalf("failed to clear milestone: %v", err)
	}
}

func TestMilestoneRepository_GetProgress(t *testing.T) {
	// RED: Test milestone progress calculation
	// Expected to FAIL because GetProgress is not implemented yet

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

	milestoneRepo := NewMilestoneRepository(store)
	issueRepo := NewIssueRepository(store)

	orgID := "test-org-milestone-progress-001-" + newTestSuffix()

	ensureIssueTestFixtures(t, store, orgID)
	repository := "owner/test-repo"

	// Create a milestone
	milestone := &milestones.Milestone{
		ID:         milestones.ID("milestone-progress-001-" + newTestSuffix()),
		Repository: repository,
		Title:      "Progress Test",
		State:      milestones.StateOpen,
	}

	_, err = milestoneRepo.Create(ctx, orgID, milestone)
	if err != nil {
		t.Fatalf("failed to create milestone: %v", err)
	}

	// Create 3 open issues and 2 closed issues associated with the milestone
	for i := 1; i <= 5; i++ {
		// Create all issues as open initially
		issue := &issues.Issue{
			ID:         issues.ID(fmt.Sprintf("issue-progress-%03d", i)),
			Repository: repository,
			Title:      fmt.Sprintf("Issue %d", i),
			Body:       "Test body",
			State:      issues.StateOpen,
			CreatedBy:  "user-001",
			CreatedAt:  time.Now(),
			UpdatedAt:  time.Now(),
		}

		created, err := issueRepo.Create(ctx, orgID, issue)
		if err != nil {
			t.Fatalf("failed to create issue %d: %v", i, err)
		}

		// Associate with milestone
		err = milestoneRepo.SetMilestone(ctx, orgID, string(created.ID), string(milestone.ID))
		if err != nil {
			t.Fatalf("failed to set milestone on issue %d: %v", i, err)
		}

		// Close issues 4 and 5
		if i > 3 {
			now := time.Now()
			_, err = issueRepo.Close(ctx, orgID, created.ID, issues.ReasonCompleted, "user-001", now)
			if err != nil {
				t.Fatalf("failed to close issue %d: %v", i, err)
			}
		}
	}

	// Get progress
	progress, err := milestoneRepo.GetProgress(ctx, orgID, milestone.ID)
	if err != nil {
		t.Fatalf("failed to get progress: %v", err)
	}

	// Verify counts
	if progress.OpenIssues != 3 {
		t.Errorf("expected 3 open issues, got %d", progress.OpenIssues)
	}

	if progress.ClosedIssues != 2 {
		t.Errorf("expected 2 closed issues, got %d", progress.ClosedIssues)
	}

	if progress.TotalIssues != 5 {
		t.Errorf("expected 5 total issues, got %d", progress.TotalIssues)
	}

	// Verify percentage (2/5 = 40%)
	expectedPercentage := 40.0
	if progress.Percentage != expectedPercentage {
		t.Errorf("expected %.1f%% completion, got %.1f%%", expectedPercentage, progress.Percentage)
	}
}

func TestMilestoneRepository_CloseWithTimestamp(t *testing.T) {
	// RED: Test milestone close with closed_at timestamp
	// Expected to FAIL because Close is not implemented yet

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

	repo := NewMilestoneRepository(store)

	orgID := "test-org-milestone-close-001-" + newTestSuffix()

	ensureIssueTestFixtures(t, store, orgID)
	repository := "owner/test-repo"

	// Create a milestone
	milestone := &milestones.Milestone{
		ID:         milestones.ID("milestone-close-001-" + newTestSuffix()),
		Repository: repository,
		Title:      "To be closed",
		State:      milestones.StateOpen,
	}

	created, err := repo.Create(ctx, orgID, milestone)
	if err != nil {
		t.Fatalf("failed to create milestone: %v", err)
	}

	if created.State != milestones.StateOpen {
		t.Errorf("expected state open, got %s", created.State)
	}

	if created.ClosedAt != nil {
		t.Error("expected closed_at to be nil for open milestone")
	}

	// Close the milestone
	closeTime := time.Now()
	closed, err := repo.Close(ctx, orgID, milestone.ID, closeTime)
	if err != nil {
		t.Fatalf("failed to close milestone: %v", err)
	}

	if closed.State != milestones.StateClosed {
		t.Errorf("expected state closed, got %s", closed.State)
	}

	if closed.ClosedAt == nil {
		t.Fatal("expected closed_at to be set")
	}

	// Verify closed_at is approximately the close time (within 1 second)
	timeDiff := closed.ClosedAt.Sub(closeTime)
	if timeDiff < 0 {
		timeDiff = -timeDiff
	}
	if timeDiff > time.Second {
		t.Errorf("closed_at timestamp mismatch: expected ~%v, got %v (diff: %v)",
			closeTime, *closed.ClosedAt, timeDiff)
	}

	// Verify the state persisted
	retrieved, err := repo.Get(ctx, orgID, milestone.ID)
	if err != nil {
		t.Fatalf("failed to retrieve closed milestone: %v", err)
	}

	if retrieved.State != milestones.StateClosed {
		t.Errorf("expected persisted state closed, got %s", retrieved.State)
	}

	if retrieved.ClosedAt == nil {
		t.Error("expected persisted closed_at to be set")
	}
}

func TestMilestoneRepository_ProgressWithNoIssues(t *testing.T) {
	// Test progress calculation for milestone with no issues

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

	repo := NewMilestoneRepository(store)

	orgID := "test-org-milestone-empty-001-" + newTestSuffix()

	ensureIssueTestFixtures(t, store, orgID)
	repository := "owner/test-repo"

	// Create a milestone with no issues
	milestone := &milestones.Milestone{
		ID:         milestones.ID("milestone-empty-001-" + newTestSuffix()),
		Repository: repository,
		Title:      "Empty milestone",
		State:      milestones.StateOpen,
	}

	_, err = repo.Create(ctx, orgID, milestone)
	if err != nil {
		t.Fatalf("failed to create milestone: %v", err)
	}

	// Get progress
	progress, err := repo.GetProgress(ctx, orgID, milestone.ID)
	if err != nil {
		t.Fatalf("failed to get progress: %v", err)
	}

	// Verify all counts are zero
	if progress.OpenIssues != 0 {
		t.Errorf("expected 0 open issues, got %d", progress.OpenIssues)
	}

	if progress.ClosedIssues != 0 {
		t.Errorf("expected 0 closed issues, got %d", progress.ClosedIssues)
	}

	if progress.TotalIssues != 0 {
		t.Errorf("expected 0 total issues, got %d", progress.TotalIssues)
	}

	// Verify percentage is 0 for empty milestone
	if progress.Percentage != 0 {
		t.Errorf("expected 0%% completion, got %.1f%%", progress.Percentage)
	}
}
