package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/comments"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

func TestCommentRepository_CreateOnIssue(t *testing.T) {
	// RED: This test verifies that comments can be created on issues
	// Expected to FAIL because CommentRepository doesn't exist yet

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
	commentRepo := NewCommentRepository(store)

	orgID := "test-org-005"
	repo1 := "owner/comment-test"

	// Create a test issue first
	now := time.Now().UTC()
	issue := &issues.Issue{
		ID:         "issue-comment-001",
		Repository: repo1,
		Title:      "Issue with comments",
		Body:       "This issue will have comments",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	createdIssue, err := issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Test 1: Create comment on issue
	comment := &comments.Comment{
		ID:           "comment-001",
		ResourceType: comments.ResourceTypeIssue,
		ResourceID:   comments.ID(createdIssue.ID),
		Body:         "This is the first comment",
		AuthorID:     "user-002",
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	created, err := commentRepo.Create(ctx, orgID, comment)
	if err != nil {
		t.Fatalf("failed to create comment: %v", err)
	}

	if created.ID != comment.ID {
		t.Errorf("expected comment ID %s, got %s", comment.ID, created.ID)
	}

	if created.Body != comment.Body {
		t.Errorf("expected body %q, got %q", comment.Body, created.Body)
	}

	// Test 2: List comments for the issue
	commentsList, err := commentRepo.List(ctx, orgID, comments.ResourceTypeIssue, comments.ID(createdIssue.ID))
	if err != nil {
		t.Fatalf("failed to list comments: %v", err)
	}

	if len(commentsList) != 1 {
		t.Errorf("expected 1 comment, got %d", len(commentsList))
	}

	// Test 3: Verify issue comments_count incremented
	retrievedIssue, err := issueRepo.Get(ctx, orgID, repo1, createdIssue.Number)
	if err != nil {
		t.Fatalf("failed to retrieve issue: %v", err)
	}

	if retrievedIssue.CommentsCount != 1 {
		t.Errorf("expected comments_count 1, got %d", retrievedIssue.CommentsCount)
	}

	// Test 4: Create second comment
	comment2 := &comments.Comment{
		ID:           "comment-002",
		ResourceType: comments.ResourceTypeIssue,
		ResourceID:   comments.ID(createdIssue.ID),
		Body:         "This is the second comment",
		AuthorID:     "user-003",
		CreatedAt:    now.Add(1 * time.Minute),
		UpdatedAt:    now.Add(1 * time.Minute),
	}

	_, err = commentRepo.Create(ctx, orgID, comment2)
	if err != nil {
		t.Fatalf("failed to create second comment: %v", err)
	}

	// Verify 2 comments now
	commentsList, err = commentRepo.List(ctx, orgID, comments.ResourceTypeIssue, comments.ID(createdIssue.ID))
	if err != nil {
		t.Fatalf("failed to list comments again: %v", err)
	}

	if len(commentsList) != 2 {
		t.Errorf("expected 2 comments, got %d", len(commentsList))
	}

	// Comments should be ordered by created_at ASC (chronological)
	if commentsList[0].ID != "comment-001" {
		t.Errorf("expected first comment to be comment-001, got %s", commentsList[0].ID)
	}

	if commentsList[1].ID != "comment-002" {
		t.Errorf("expected second comment to be comment-002, got %s", commentsList[1].ID)
	}
}
