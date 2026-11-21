package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/milestones"
)

func TestMilestoneRepository_CreateAndGet(t *testing.T) {
	// RED: Test milestone creation and retrieval
	// Expected to FAIL because MilestoneRepository is not implemented yet

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

	// Create MilestoneRepository (doesn't exist yet - will fail to compile)
	repo := NewMilestoneRepository(store)

	orgID := "test-org-milestone-001"

	ensureIssueTestFixtures(t, store, orgID)
	repository := "owner/test-repo"
	dueDate := time.Now().Add(30 * 24 * time.Hour)

	// Test: Create a milestone
	milestone := &milestones.Milestone{
		ID:          "milestone-001",
		Repository:  repository,
		Title:       "Version 1.0",
		Description: "First major release",
		DueOn:       &dueDate,
		State:       milestones.StateOpen,
	}

	created, err := repo.Create(ctx, orgID, milestone)
	if err != nil {
		t.Fatalf("failed to create milestone: %v", err)
	}

	if created.ID != milestone.ID {
		t.Errorf("expected ID %s, got %s", milestone.ID, created.ID)
	}

	if created.Title != milestone.Title {
		t.Errorf("expected title %s, got %s", milestone.Title, created.Title)
	}

	if created.State != milestones.StateOpen {
		t.Errorf("expected state open, got %s", created.State)
	}

	if created.CreatedAt.IsZero() {
		t.Error("expected created_at to be set")
	}

	if created.UpdatedAt.IsZero() {
		t.Error("expected updated_at to be set")
	}

	if created.ClosedAt != nil {
		t.Error("expected closed_at to be nil for open milestone")
	}

	// Test: Retrieve the milestone
	retrieved, err := repo.Get(ctx, orgID, milestone.ID)
	if err != nil {
		t.Fatalf("failed to retrieve milestone: %v", err)
	}

	if retrieved.ID != milestone.ID {
		t.Errorf("expected ID %s, got %s", milestone.ID, retrieved.ID)
	}

	if retrieved.Title != milestone.Title {
		t.Errorf("expected title %s, got %s", milestone.Title, retrieved.Title)
	}

	if retrieved.Description != milestone.Description {
		t.Errorf("expected description %s, got %s", milestone.Description, retrieved.Description)
	}
}

func TestMilestoneRepository_List(t *testing.T) {
	// RED: Test milestone listing with state filter
	// Expected to FAIL because List is not implemented yet

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

	orgID := "test-org-milestone-002"

	ensureIssueTestFixtures(t, store, orgID)
	repository := "owner/test-repo"

	// Create two open milestones
	m1 := &milestones.Milestone{
		ID:         "milestone-open-1",
		Repository: repository,
		Title:      "Sprint 1",
		State:      milestones.StateOpen,
	}

	m2 := &milestones.Milestone{
		ID:         "milestone-open-2",
		Repository: repository,
		Title:      "Sprint 2",
		State:      milestones.StateOpen,
	}

	_, err = repo.Create(ctx, orgID, m1)
	if err != nil {
		t.Fatalf("failed to create milestone 1: %v", err)
	}

	_, err = repo.Create(ctx, orgID, m2)
	if err != nil {
		t.Fatalf("failed to create milestone 2: %v", err)
	}

	// Close one milestone
	_, err = repo.Close(ctx, orgID, m1.ID, time.Now())
	if err != nil {
		t.Fatalf("failed to close milestone: %v", err)
	}

	// List open milestones - should return only m2
	openMilestones, err := repo.List(ctx, orgID, repository, milestones.StateOpen)
	if err != nil {
		t.Fatalf("failed to list open milestones: %v", err)
	}

	if len(openMilestones) != 1 {
		t.Errorf("expected 1 open milestone, got %d", len(openMilestones))
	}

	if len(openMilestones) > 0 && openMilestones[0].ID != m2.ID {
		t.Errorf("expected milestone %s, got %s", m2.ID, openMilestones[0].ID)
	}

	// List closed milestones - should return only m1
	closedMilestones, err := repo.List(ctx, orgID, repository, milestones.StateClosed)
	if err != nil {
		t.Fatalf("failed to list closed milestones: %v", err)
	}

	if len(closedMilestones) != 1 {
		t.Errorf("expected 1 closed milestone, got %d", len(closedMilestones))
	}

	if len(closedMilestones) > 0 && closedMilestones[0].State != milestones.StateClosed {
		t.Errorf("expected state closed, got %s", closedMilestones[0].State)
	}

	if len(closedMilestones) > 0 && closedMilestones[0].ClosedAt == nil {
		t.Error("expected closed_at to be set for closed milestone")
	}
}

func TestMilestoneRepository_Update(t *testing.T) {
	// RED: Test milestone update
	// Expected to FAIL because Update is not implemented yet

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

	orgID := "test-org-milestone-003"

	ensureIssueTestFixtures(t, store, orgID)
	repository := "owner/test-repo"

	// Create a milestone
	original := &milestones.Milestone{
		ID:          "milestone-update-001",
		Repository:  repository,
		Title:       "Original Title",
		Description: "Original description",
		State:       milestones.StateOpen,
	}

	created, err := repo.Create(ctx, orgID, original)
	if err != nil {
		t.Fatalf("failed to create milestone: %v", err)
	}

	// Update the milestone
	newDueDate := time.Now().Add(60 * 24 * time.Hour)
	updated := &milestones.Milestone{
		ID:          created.ID,
		Repository:  repository,
		Title:       "Updated Title",
		Description: "Updated description",
		DueOn:       &newDueDate,
		State:       milestones.StateOpen,
	}

	result, err := repo.Update(ctx, orgID, updated)
	if err != nil {
		t.Fatalf("failed to update milestone: %v", err)
	}

	if result.Title != "Updated Title" {
		t.Errorf("expected title 'Updated Title', got %s", result.Title)
	}

	if result.Description != "Updated description" {
		t.Errorf("expected description 'Updated description', got %s", result.Description)
	}

	if result.DueOn == nil {
		t.Error("expected due_on to be set")
	}

	// Verify the update persisted
	retrieved, err := repo.Get(ctx, orgID, created.ID)
	if err != nil {
		t.Fatalf("failed to retrieve updated milestone: %v", err)
	}

	if retrieved.Title != "Updated Title" {
		t.Errorf("expected persisted title 'Updated Title', got %s", retrieved.Title)
	}
}

func TestMilestoneRepository_Delete(t *testing.T) {
	// RED: Test milestone deletion
	// Expected to FAIL because Delete is not implemented yet

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

	orgID := "test-org-milestone-004"

	ensureIssueTestFixtures(t, store, orgID)
	repository := "owner/test-repo"

	// Create a milestone
	milestone := &milestones.Milestone{
		ID:         "milestone-delete-001",
		Repository: repository,
		Title:      "To be deleted",
		State:      milestones.StateOpen,
	}

	_, err = repo.Create(ctx, orgID, milestone)
	if err != nil {
		t.Fatalf("failed to create milestone: %v", err)
	}

	// Delete the milestone
	err = repo.Delete(ctx, orgID, milestone.ID)
	if err != nil {
		t.Fatalf("failed to delete milestone: %v", err)
	}

	// Verify it's deleted
	_, err = repo.Get(ctx, orgID, milestone.ID)
	if err == nil {
		t.Error("expected error when retrieving deleted milestone, got nil")
	}
}
