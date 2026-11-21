package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/notifications"
)

func TestNotificationRepository_SubscribeAndList(t *testing.T) {
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

	repo := NewNotificationRepository(store)
	orgID := "test-org-notif"
	ensureIssueTestFixtures(t, store, orgID)
	userID := "user-001"
	issueID := "issue-001"

	// Test 1: Subscribe to issue
	if err := repo.Subscribe(ctx, orgID, userID, issueID); err != nil {
		t.Fatalf("failed to subscribe: %v", err)
	}

	// Test 2: Check subscription
	subscribed, err := repo.IsSubscribed(ctx, orgID, userID, issueID)
	if err != nil {
		t.Fatalf("failed to check subscription: %v", err)
	}
	if !subscribed {
		t.Error("expected user to be subscribed")
	}

	// Test 3: Get subscribers
	subscribers, err := repo.GetSubscribers(ctx, orgID, issueID)
	if err != nil {
		t.Fatalf("failed to get subscribers: %v", err)
	}
	if len(subscribers) != 1 || subscribers[0] != userID {
		t.Errorf("expected 1 subscriber [%s], got %v", userID, subscribers)
	}

	// Test 4: Create notifications
	notif1 := &notifications.Notification{
		ID:          "notif-001",
		UserID:      userID,
		Type:        notifications.TypeComment,
		Reason:      notifications.ReasonSubscribed,
		IssueID:     issueID,
		Repository:  "test-repo",
		IssueNumber: 42,
		IssueTitle:  "Test issue",
		ActorID:     "user-002",
		Unread:      true,
		CreatedAt:   time.Now().UTC(),
	}

	if err := repo.Create(ctx, orgID, notif1); err != nil {
		t.Fatalf("failed to create notification: %v", err)
	}

	notif2 := &notifications.Notification{
		ID:          "notif-002",
		UserID:      userID,
		Type:        notifications.TypeMention,
		Reason:      notifications.ReasonMentioned,
		IssueID:     issueID,
		Repository:  "test-repo",
		IssueNumber: 42,
		IssueTitle:  "Test issue",
		CommentID:   "comment-001",
		ActorID:     "user-003",
		Unread:      true,
		CreatedAt:   time.Now().UTC().Add(-1 * time.Hour),
	}

	if err := repo.Create(ctx, orgID, notif2); err != nil {
		t.Fatalf("failed to create notification 2: %v", err)
	}

	// Test 5: List all notifications
	notifications, total, err := repo.List(ctx, orgID, userID, false, 10, 0)
	if err != nil {
		t.Fatalf("failed to list notifications: %v", err)
	}
	if total != 2 {
		t.Errorf("expected 2 total notifications, got %d", total)
	}
	if len(notifications) != 2 {
		t.Errorf("expected 2 notifications, got %d", len(notifications))
	}

	// Verify chronological order (newest first)
	if notifications[0].ID != "notif-001" {
		t.Errorf("expected first notification to be notif-001, got %s", notifications[0].ID)
	}

	// Test 6: List unread only
	unreadNotifs, unreadTotal, err := repo.List(ctx, orgID, userID, true, 10, 0)
	if err != nil {
		t.Fatalf("failed to list unread notifications: %v", err)
	}
	if unreadTotal != 2 {
		t.Errorf("expected 2 unread notifications, got %d", unreadTotal)
	}
	if len(unreadNotifs) != 2 {
		t.Errorf("expected 2 unread notifications, got %d", len(unreadNotifs))
	}

	// Test 7: Mark one as read
	if err := repo.MarkAsRead(ctx, orgID, "notif-001", userID); err != nil {
		t.Fatalf("failed to mark as read: %v", err)
	}

	// Verify unread count decreased
	unreadNotifs2, unreadTotal2, err := repo.List(ctx, orgID, userID, true, 10, 0)
	if err != nil {
		t.Fatalf("failed to list unread notifications after marking: %v", err)
	}
	if unreadTotal2 != 1 {
		t.Errorf("expected 1 unread notification after marking one read, got %d", unreadTotal2)
	}
	if len(unreadNotifs2) != 1 || unreadNotifs2[0].ID != "notif-002" {
		t.Error("expected only notif-002 to be unread")
	}

	// Test 8: Mark all as read
	if err := repo.MarkAllAsRead(ctx, orgID, userID); err != nil {
		t.Fatalf("failed to mark all as read: %v", err)
	}

	unreadNotifs3, unreadTotal3, err := repo.List(ctx, orgID, userID, true, 10, 0)
	if err != nil {
		t.Fatalf("failed to list unread notifications after marking all: %v", err)
	}
	if unreadTotal3 != 0 {
		t.Errorf("expected 0 unread notifications after marking all read, got %d", unreadTotal3)
	}
	if len(unreadNotifs3) != 0 {
		t.Errorf("expected no unread notifications, got %d", len(unreadNotifs3))
	}

	// Test 9: Unsubscribe
	if err := repo.Unsubscribe(ctx, orgID, userID, issueID); err != nil {
		t.Fatalf("failed to unsubscribe: %v", err)
	}

	subscribed2, err := repo.IsSubscribed(ctx, orgID, userID, issueID)
	if err != nil {
		t.Fatalf("failed to check subscription after unsubscribe: %v", err)
	}
	if subscribed2 {
		t.Error("expected user to not be subscribed after unsubscribe")
	}

	// Test 10: Delete notification
	if err := repo.Delete(ctx, orgID, "notif-001", userID); err != nil {
		t.Fatalf("failed to delete notification: %v", err)
	}

	allNotifs, allTotal, err := repo.List(ctx, orgID, userID, false, 10, 0)
	if err != nil {
		t.Fatalf("failed to list notifications after delete: %v", err)
	}
	if allTotal != 1 {
		t.Errorf("expected 1 notification after delete, got %d", allTotal)
	}
	if len(allNotifs) != 1 || allNotifs[0].ID != "notif-002" {
		t.Error("expected only notif-002 to remain")
	}
}

func TestNotificationRepository_Pagination(t *testing.T) {
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

	repo := NewNotificationRepository(store)
	orgID := "test-org-pagination"
	ensureIssueTestFixtures(t, store, orgID)
	userID := "user-page"
	issueID := "issue-page"

	// Create organization
	_, err = store.pool.Exec(ctx, "INSERT INTO organizations (id, name) VALUES ($1, $2)", orgID, orgID)
	if err != nil {
		t.Fatalf("failed to create organization: %v", err)
	}

	// Create 5 notifications
	for i := 0; i < 5; i++ {
		notif := &notifications.Notification{
			ID:          notifications.ID("notif-page-" + string(rune('0'+i))),
			UserID:      userID,
			Type:        notifications.TypeComment,
			Reason:      notifications.ReasonSubscribed,
			IssueID:     issueID,
			Repository:  "test-repo",
			IssueNumber: 1,
			IssueTitle:  "Test",
			Unread:      true,
			CreatedAt:   time.Now().UTC().Add(time.Duration(-i) * time.Minute),
		}
		if err := repo.Create(ctx, orgID, notif); err != nil {
			t.Fatalf("failed to create notification %d: %v", i, err)
		}
	}

	// Test pagination: first page (limit 2)
	page1, total, err := repo.List(ctx, orgID, userID, false, 2, 0)
	if err != nil {
		t.Fatalf("failed to list page 1: %v", err)
	}
	if total != 5 {
		t.Errorf("expected total 5, got %d", total)
	}
	if len(page1) != 2 {
		t.Errorf("expected 2 items on page 1, got %d", len(page1))
	}

	// Test pagination: second page
	page2, _, err := repo.List(ctx, orgID, userID, false, 2, 2)
	if err != nil {
		t.Fatalf("failed to list page 2: %v", err)
	}
	if len(page2) != 2 {
		t.Errorf("expected 2 items on page 2, got %d", len(page2))
	}

	// Test pagination: third page
	page3, _, err := repo.List(ctx, orgID, userID, false, 2, 4)
	if err != nil {
		t.Fatalf("failed to list page 3: %v", err)
	}
	if len(page3) != 1 {
		t.Errorf("expected 1 item on page 3, got %d", len(page3))
	}

	// Verify no overlap between pages
	if page1[0].ID == page2[0].ID || page1[1].ID == page2[1].ID {
		t.Error("overlap detected between page 1 and page 2")
	}
}
