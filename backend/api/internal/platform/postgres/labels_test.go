package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/labels"
)

func TestLabelRepository_Create(t *testing.T) {
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

	repo := NewLabelRepository(store)
	orgID := "test-org-labels-001"
	ensureIssueTestFixtures(t, store, orgID)
	repoName := "owner/test-repo"

	label := &labels.Label{
		ID:          labels.ID("label-001"),
		Repository:  repoName,
		Name:        "bug",
		Description: "Something isn't working",
		Color:       "d73a4a", // GitHub red
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}

	created, err := repo.Create(ctx, orgID, label)
	if err != nil {
		t.Fatalf("failed to create label: %v", err)
	}

	if created.ID != label.ID {
		t.Errorf("expected ID %s, got %s", label.ID, created.ID)
	}
	if created.Name != label.Name {
		t.Errorf("expected name %s, got %s", label.Name, created.Name)
	}
	if created.Color != label.Color {
		t.Errorf("expected color %s, got %s", label.Color, created.Color)
	}
}

func TestLabelRepository_CreateValidatesColor(t *testing.T) {
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

	repo := NewLabelRepository(store)
	orgID := "test-org-labels-002"

	ensureIssueTestFixtures(t, store, orgID)
	tests := []struct {
		name      string
		color     string
		shouldErr bool
	}{
		{"valid lowercase", "d73a4a", false},
		{"valid uppercase", "D73A4A", false},
		{"valid mixed", "A2EeEf", false},
		{"invalid too short", "d73", true},
		{"invalid too long", "d73a4a1", true},
		{"invalid with hash", "#d73a4a", true},
		{"invalid chars", "gggggg", true},
		{"empty", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			label := &labels.Label{
				ID:         labels.ID("label-color-" + tt.name),
				Repository: "owner/color-test",
				Name:       "test-" + tt.name,
				Color:      tt.color,
				CreatedAt:  time.Now().UTC(),
				UpdatedAt:  time.Now().UTC(),
			}

			_, err := repo.Create(ctx, orgID, label)
			if tt.shouldErr && err == nil {
				t.Errorf("expected error for color %s, got nil", tt.color)
			}
			if !tt.shouldErr && err != nil {
				t.Errorf("expected no error for color %s, got %v", tt.color, err)
			}
		})
	}
}

func TestLabelRepository_CreateEnforcesUniqueNamePerRepo(t *testing.T) {
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

	repo := NewLabelRepository(store)
	orgID := "test-org-labels-003"
	ensureIssueTestFixtures(t, store, orgID)
	repoA := "owner/repo-a"
	repoB := "owner/repo-b"

	// Create label in repo A
	label1 := &labels.Label{
		ID:         labels.ID("label-unique-001"),
		Repository: repoA,
		Name:       "bug",
		Color:      "d73a4a",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}
	_, err = repo.Create(ctx, orgID, label1)
	if err != nil {
		t.Fatalf("failed to create first label: %v", err)
	}

	// Attempt to create same name in repo A - should fail
	label2 := &labels.Label{
		ID:         labels.ID("label-unique-002"),
		Repository: repoA,
		Name:       "bug",
		Color:      "ff0000",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}
	_, err = repo.Create(ctx, orgID, label2)
	if err == nil {
		t.Error("expected error when creating duplicate label name in same repo, got nil")
	}

	// Create same name in repo B - should succeed
	label3 := &labels.Label{
		ID:         labels.ID("label-unique-003"),
		Repository: repoB,
		Name:       "bug",
		Color:      "d73a4a",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}
	_, err = repo.Create(ctx, orgID, label3)
	if err != nil {
		t.Errorf("expected no error when creating same label name in different repo, got %v", err)
	}
}

func TestLabelRepository_Get(t *testing.T) {
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

	repo := NewLabelRepository(store)
	orgID := "test-org-labels-004"

	ensureIssueTestFixtures(t, store, orgID)
	label := &labels.Label{
		ID:          labels.ID("label-get-001"),
		Repository:  "owner/get-test",
		Name:        "enhancement",
		Description: "New feature or request",
		Color:       "a2eeef",
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}

	_, err = repo.Create(ctx, orgID, label)
	if err != nil {
		t.Fatalf("failed to create label: %v", err)
	}

	retrieved, err := repo.Get(ctx, orgID, label.ID)
	if err != nil {
		t.Fatalf("failed to get label: %v", err)
	}

	if retrieved.ID != label.ID {
		t.Errorf("expected ID %s, got %s", label.ID, retrieved.ID)
	}
	if retrieved.Name != label.Name {
		t.Errorf("expected name %s, got %s", label.Name, retrieved.Name)
	}
	if retrieved.Description != label.Description {
		t.Errorf("expected description %s, got %s", label.Description, retrieved.Description)
	}
	if retrieved.Color != label.Color {
		t.Errorf("expected color %s, got %s", label.Color, retrieved.Color)
	}
}

func TestLabelRepository_List(t *testing.T) {
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

	repo := NewLabelRepository(store)
	orgID := "test-org-labels-005"
	ensureIssueTestFixtures(t, store, orgID)
	repoName := "owner/list-test"

	// Create multiple labels
	testLabels := []labels.Label{
		{ID: labels.ID("label-list-001"), Repository: repoName, Name: "bug", Color: "d73a4a", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{ID: labels.ID("label-list-002"), Repository: repoName, Name: "enhancement", Color: "a2eeef", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{ID: labels.ID("label-list-003"), Repository: repoName, Name: "documentation", Color: "0075ca", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
	}

	for _, label := range testLabels {
		l := label
		_, err := repo.Create(ctx, orgID, &l)
		if err != nil {
			t.Fatalf("failed to create label %s: %v", label.Name, err)
		}
	}

	// List all labels for repository
	filter := labels.ListFilter{Repository: repoName}
	results, err := repo.List(ctx, orgID, filter)
	if err != nil {
		t.Fatalf("failed to list labels: %v", err)
	}

	if len(results) != 3 {
		t.Errorf("expected 3 labels, got %d", len(results))
	}
}

func TestLabelRepository_Update(t *testing.T) {
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

	repo := NewLabelRepository(store)
	orgID := "test-org-labels-006"

	ensureIssueTestFixtures(t, store, orgID)
	label := &labels.Label{
		ID:          labels.ID("label-update-001"),
		Repository:  "owner/update-test",
		Name:        "bug",
		Description: "Old description",
		Color:       "d73a4a",
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}

	_, err = repo.Create(ctx, orgID, label)
	if err != nil {
		t.Fatalf("failed to create label: %v", err)
	}

	// Update label
	label.Name = "critical-bug"
	label.Description = "New description"
	label.Color = "ff0000"
	label.UpdatedAt = time.Now().UTC()

	updated, err := repo.Update(ctx, orgID, label)
	if err != nil {
		t.Fatalf("failed to update label: %v", err)
	}

	if updated.Name != "critical-bug" {
		t.Errorf("expected name 'critical-bug', got %s", updated.Name)
	}
	if updated.Description != "New description" {
		t.Errorf("expected new description, got %s", updated.Description)
	}
	if updated.Color != "ff0000" {
		t.Errorf("expected color ff0000, got %s", updated.Color)
	}
}

func TestLabelRepository_Delete(t *testing.T) {
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

	repo := NewLabelRepository(store)
	orgID := "test-org-labels-007"

	ensureIssueTestFixtures(t, store, orgID)
	label := &labels.Label{
		ID:         labels.ID("label-delete-001"),
		Repository: "owner/delete-test",
		Name:       "wontfix",
		Color:      "ffffff",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}

	_, err = repo.Create(ctx, orgID, label)
	if err != nil {
		t.Fatalf("failed to create label: %v", err)
	}

	err = repo.Delete(ctx, orgID, label.ID)
	if err != nil {
		t.Fatalf("failed to delete label: %v", err)
	}

	// Verify deletion
	_, err = repo.Get(ctx, orgID, label.ID)
	if err == nil {
		t.Error("expected error when getting deleted label, got nil")
	}
}

func TestLabelRepository_AddLabelToIssue(t *testing.T) {
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

	labelRepo := NewLabelRepository(store)
	orgID := "test-org-labels-008"
	ensureIssueTestFixtures(t, store, orgID)
	issueID := "issue-label-001"

	// Create test issue (required by foreign key constraint)
	_, err = store.pool.Exec(ctx, `
		INSERT INTO issues (organization_id, id, repository, number, title, created_by)
		VALUES ($1, $2, 'owner/assoc-test', 1, 'Test issue', 'user-001')
	`, orgID, issueID)
	if err != nil {
		t.Fatalf("failed to create test issue: %v", err)
	}

	label := &labels.Label{
		ID:         labels.ID("label-assoc-001"),
		Repository: "owner/assoc-test",
		Name:       "bug",
		Color:      "d73a4a",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}

	_, err = labelRepo.Create(ctx, orgID, label)
	if err != nil {
		t.Fatalf("failed to create label: %v", err)
	}

	err = labelRepo.AddLabelToIssue(ctx, orgID, issueID, label.ID)
	if err != nil {
		t.Fatalf("failed to add label to issue: %v", err)
	}

	// Verify association
	issueLabels, err := labelRepo.GetLabelsForIssue(ctx, orgID, issueID)
	if err != nil {
		t.Fatalf("failed to get labels for issue: %v", err)
	}

	if len(issueLabels) != 1 {
		t.Fatalf("expected 1 label, got %d", len(issueLabels))
	}

	if issueLabels[0].ID != label.ID {
		t.Errorf("expected label ID %s, got %s", label.ID, issueLabels[0].ID)
	}
}

func TestLabelRepository_AddMultipleLabelsToIssue(t *testing.T) {
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

	labelRepo := NewLabelRepository(store)
	orgID := "test-org-labels-009"
	ensureIssueTestFixtures(t, store, orgID)
	issueID := "issue-multi-label-001"

	// Create test issue (required by foreign key constraint)
	_, err = store.pool.Exec(ctx, `
		INSERT INTO issues (organization_id, id, repository, number, title, created_by)
		VALUES ($1, $2, 'owner/multi-test', 1, 'Test issue', 'user-001')
	`, orgID, issueID)
	if err != nil {
		t.Fatalf("failed to create test issue: %v", err)
	}

	// Create multiple labels
	testLabels := []labels.Label{
		{ID: labels.ID("label-multi-001"), Repository: "owner/multi-test", Name: "bug", Color: "d73a4a", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{ID: labels.ID("label-multi-002"), Repository: "owner/multi-test", Name: "priority-high", Color: "ff0000", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
		{ID: labels.ID("label-multi-003"), Repository: "owner/multi-test", Name: "good-first-issue", Color: "7057ff", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()},
	}

	for _, label := range testLabels {
		l := label
		_, err := labelRepo.Create(ctx, orgID, &l)
		if err != nil {
			t.Fatalf("failed to create label %s: %v", label.Name, err)
		}

		err = labelRepo.AddLabelToIssue(ctx, orgID, issueID, label.ID)
		if err != nil {
			t.Fatalf("failed to add label %s to issue: %v", label.Name, err)
		}
	}

	// Verify all labels are associated
	issueLabels, err := labelRepo.GetLabelsForIssue(ctx, orgID, issueID)
	if err != nil {
		t.Fatalf("failed to get labels for issue: %v", err)
	}

	if len(issueLabels) != 3 {
		t.Fatalf("expected 3 labels, got %d", len(issueLabels))
	}
}

func TestLabelRepository_RemoveLabelFromIssue(t *testing.T) {
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

	labelRepo := NewLabelRepository(store)
	orgID := "test-org-labels-010"
	ensureIssueTestFixtures(t, store, orgID)
	issueID := "issue-remove-label-001"

	// Create test issue (required by foreign key constraint)
	_, err = store.pool.Exec(ctx, `
		INSERT INTO issues (organization_id, id, repository, number, title, created_by)
		VALUES ($1, $2, 'owner/remove-test', 1, 'Test issue', 'user-001')
	`, orgID, issueID)
	if err != nil {
		t.Fatalf("failed to create test issue: %v", err)
	}

	label := &labels.Label{
		ID:         labels.ID("label-remove-001"),
		Repository: "owner/remove-test",
		Name:       "bug",
		Color:      "d73a4a",
		CreatedAt:  time.Now().UTC(),
		UpdatedAt:  time.Now().UTC(),
	}

	_, err = labelRepo.Create(ctx, orgID, label)
	if err != nil {
		t.Fatalf("failed to create label: %v", err)
	}

	err = labelRepo.AddLabelToIssue(ctx, orgID, issueID, label.ID)
	if err != nil {
		t.Fatalf("failed to add label to issue: %v", err)
	}

	// Remove label from issue
	err = labelRepo.RemoveLabelFromIssue(ctx, orgID, issueID, label.ID)
	if err != nil {
		t.Fatalf("failed to remove label from issue: %v", err)
	}

	// Verify removal
	issueLabels, err := labelRepo.GetLabelsForIssue(ctx, orgID, issueID)
	if err != nil {
		t.Fatalf("failed to get labels for issue: %v", err)
	}

	if len(issueLabels) != 0 {
		t.Errorf("expected 0 labels after removal, got %d", len(issueLabels))
	}
}
