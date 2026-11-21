package postgres

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/comments"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/reactions"
)

func TestReactionRepository_AddToComment(t *testing.T) {
	// RED: This test verifies that reactions can be added to comments
	// Expected to FAIL because ReactionRepository doesn't exist yet

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
	reactionRepo := NewReactionRepository(store)

	orgID := "test-org-006"

	ensureIssueTestFixtures(t, store, orgID)
	repo1 := "owner/reaction-test"
	now := time.Now().UTC()

	// Create organization
	_, err = store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $2)", orgID, orgID)
	if err != nil {
		t.Fatalf("failed to create organization: %v", err)
	}

	// Create a test issue
	issue := &issues.Issue{
		ID:         "issue-reaction-001",
		Repository: repo1,
		Title:      "Issue with reactions",
		Body:       "Testing reactions",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	createdIssue, err := issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Create a comment
	comment := &comments.Comment{
		ID:           "comment-reaction-001",
		ResourceType: comments.ResourceTypeIssue,
		ResourceID:   comments.ID(createdIssue.ID),
		Body:         "A comment to react to",
		AuthorID:     "user-002",
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	createdComment, err := commentRepo.Create(ctx, orgID, comment)
	if err != nil {
		t.Fatalf("failed to create comment: %v", err)
	}

	// Test 1: Add a +1 reaction to the comment
	reaction1 := &reactions.Reaction{
		ID:            "reaction-001",
		ReactableType: reactions.ReactableTypeComment,
		ReactableID:   reactions.ID(createdComment.ID),
		UserID:        "user-003",
		Content:       reactions.ContentThumbsUp,
		CreatedAt:     now,
	}

	added1, err := reactionRepo.Add(ctx, orgID, reaction1)
	if err != nil {
		t.Fatalf("failed to add reaction: %v", err)
	}

	if added1.ID != reaction1.ID {
		t.Errorf("expected reaction ID %s, got %s", reaction1.ID, added1.ID)
	}

	if added1.Content != reactions.ContentThumbsUp {
		t.Errorf("expected content %s, got %s", reactions.ContentThumbsUp, added1.Content)
	}

	// Test 2: List reactions for the comment
	reactionsList, err := reactionRepo.List(ctx, orgID, reactions.ReactableTypeComment, reactions.ID(createdComment.ID))
	if err != nil {
		t.Fatalf("failed to list reactions: %v", err)
	}

	if len(reactionsList) != 1 {
		t.Errorf("expected 1 reaction, got %d", len(reactionsList))
	}

	// Test 3: Same user adds a different reaction (heart)
	reaction2 := &reactions.Reaction{
		ID:            "reaction-002",
		ReactableType: reactions.ReactableTypeComment,
		ReactableID:   reactions.ID(createdComment.ID),
		UserID:        "user-003",
		Content:       reactions.ContentHeart,
		CreatedAt:     now,
	}

	_, err = reactionRepo.Add(ctx, orgID, reaction2)
	if err != nil {
		t.Fatalf("failed to add second reaction: %v", err)
	}

	// Should now have 2 reactions from the same user
	reactionsList, err = reactionRepo.List(ctx, orgID, reactions.ReactableTypeComment, reactions.ID(createdComment.ID))
	if err != nil {
		t.Fatalf("failed to list reactions again: %v", err)
	}

	if len(reactionsList) != 2 {
		t.Errorf("expected 2 reactions, got %d", len(reactionsList))
	}

	// Test 4: Try to add duplicate reaction (same user, same emoji) - should fail
	reactionDup := &reactions.Reaction{
		ID:            "reaction-003",
		ReactableType: reactions.ReactableTypeComment,
		ReactableID:   reactions.ID(createdComment.ID),
		UserID:        "user-003",
		Content:       reactions.ContentThumbsUp, // Duplicate
		CreatedAt:     now,
	}

	_, err = reactionRepo.Add(ctx, orgID, reactionDup)
	if err == nil {
		t.Error("expected error when adding duplicate reaction, got nil")
	}

	// Test 5: Different user adds +1 - should succeed
	reaction3 := &reactions.Reaction{
		ID:            "reaction-004",
		ReactableType: reactions.ReactableTypeComment,
		ReactableID:   reactions.ID(createdComment.ID),
		UserID:        "user-004", // Different user
		Content:       reactions.ContentThumbsUp,
		CreatedAt:     now,
	}

	_, err = reactionRepo.Add(ctx, orgID, reaction3)
	if err != nil {
		t.Fatalf("failed to add reaction from different user: %v", err)
	}

	// Should now have 3 reactions total
	reactionsList, err = reactionRepo.List(ctx, orgID, reactions.ReactableTypeComment, reactions.ID(createdComment.ID))
	if err != nil {
		t.Fatalf("failed to list reactions: %v", err)
	}

	if len(reactionsList) != 3 {
		t.Errorf("expected 3 reactions, got %d", len(reactionsList))
	}

	// Test 6: Remove a reaction
	err = reactionRepo.Remove(ctx, orgID, reactions.ID(reaction1.ID))
	if err != nil {
		t.Fatalf("failed to remove reaction: %v", err)
	}

	// Should now have 2 reactions
	reactionsList, err = reactionRepo.List(ctx, orgID, reactions.ReactableTypeComment, reactions.ID(createdComment.ID))
	if err != nil {
		t.Fatalf("failed to list reactions after removal: %v", err)
	}

	if len(reactionsList) != 2 {
		t.Errorf("expected 2 reactions after removal, got %d", len(reactionsList))
	}

	// Test 7: Verify all 8 GitHub emoji types are supported
	supportedEmojis := []reactions.Content{
		reactions.ContentThumbsUp,
		reactions.ContentThumbsDown,
		reactions.ContentLaugh,
		reactions.ContentConfused,
		reactions.ContentHeart,
		reactions.ContentHooray,
		reactions.ContentRocket,
		reactions.ContentEyes,
	}

	for i, emoji := range supportedEmojis {
		r := &reactions.Reaction{
			ID:            reactions.ID(fmt.Sprintf("reaction-emoji-%d", i)),
			ReactableType: reactions.ReactableTypeComment,
			ReactableID:   reactions.ID(createdComment.ID),
			UserID:        "user-emoji-test",
			Content:       emoji,
			CreatedAt:     now,
		}

		_, err := reactionRepo.Add(ctx, orgID, r)
		if err != nil {
			t.Errorf("failed to add reaction with emoji %s: %v", emoji, err)
		}
	}
}

func TestReactionRepository_AddToIssue(t *testing.T) {
	// Test reactions on issues (polymorphic support)

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
	reactionRepo := NewReactionRepository(store)

	orgID := "test-org-007"

	ensureIssueTestFixtures(t, store, orgID)
	repo1 := "owner/issue-reaction-test"
	now := time.Now().UTC()

	// Create organization
	_, err = store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $2)", orgID, orgID)
	if err != nil {
		t.Fatalf("failed to create organization: %v", err)
	}

	// Create a test issue
	issue := &issues.Issue{
		ID:         "issue-reaction-002",
		Repository: repo1,
		Title:      "Issue to react to",
		Body:       "Testing reactions on issues",
		State:      issues.StateOpen,
		CreatedBy:  "user-001",
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	createdIssue, err := issueRepo.Create(ctx, orgID, issue)
	if err != nil {
		t.Fatalf("failed to create issue: %v", err)
	}

	// Add a reaction to the issue
	reaction := &reactions.Reaction{
		ID:            "reaction-issue-001",
		ReactableType: reactions.ReactableTypeIssue,
		ReactableID:   reactions.ID(createdIssue.ID),
		UserID:        "user-005",
		Content:       reactions.ContentRocket,
		CreatedAt:     now,
	}

	added, err := reactionRepo.Add(ctx, orgID, reaction)
	if err != nil {
		t.Fatalf("failed to add reaction to issue: %v", err)
	}

	if added.ReactableType != reactions.ReactableTypeIssue {
		t.Errorf("expected reactable type %s, got %s", reactions.ReactableTypeIssue, added.ReactableType)
	}

	// List reactions for the issue
	reactionsList, err := reactionRepo.List(ctx, orgID, reactions.ReactableTypeIssue, reactions.ID(createdIssue.ID))
	if err != nil {
		t.Fatalf("failed to list reactions: %v", err)
	}

	if len(reactionsList) != 1 {
		t.Errorf("expected 1 reaction on issue, got %d", len(reactionsList))
	}
}
