package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/notifications"
)

type NotificationRepository struct {
	store *Store
}

func NewNotificationRepository(store *Store) *NotificationRepository {
	return &NotificationRepository{store: store}
}

// Create persists a new notification
func (r *NotificationRepository) Create(ctx context.Context, organizationID string, notification *notifications.Notification) error {
	var actorID sql.NullString
	if notification.ActorID != "" {
		actorID.String = notification.ActorID
		actorID.Valid = true
	}

	var commentID sql.NullString
	if notification.CommentID != "" {
		commentID.String = notification.CommentID
		commentID.Valid = true
	}

	_, err := r.store.pool.Exec(ctx, `
		INSERT INTO notifications (
			organization_id, id, user_id, type, reason,
			issue_id, repository, issue_number, issue_title,
			comment_id, actor_id, unread, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, organizationID, notification.ID, notification.UserID, notification.Type, notification.Reason,
		notification.IssueID, notification.Repository, notification.IssueNumber, notification.IssueTitle,
		commentID, actorID, notification.Unread, notification.CreatedAt)

	if err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}

	return nil
}

// List retrieves notifications for a user
func (r *NotificationRepository) List(ctx context.Context, organizationID string, userID string, unreadOnly bool, limit, offset int) ([]*notifications.Notification, int, error) {
	// Count total
	var total int
	countQuery := `
		SELECT COUNT(*)
		FROM notifications
		WHERE organization_id = $1 AND user_id = $2
	`
	countArgs := []interface{}{organizationID, userID}

	if unreadOnly {
		countQuery += ` AND unread = true`
	}

	if err := r.store.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count notifications: %w", err)
	}

	// Fetch items
	query := `
		SELECT id, user_id, type, reason, issue_id, repository,
		       issue_number, issue_title, comment_id, actor_id,
		       unread, created_at, read_at
		FROM notifications
		WHERE organization_id = $1 AND user_id = $2
	`
	args := []interface{}{organizationID, userID}

	if unreadOnly {
		query += ` AND unread = true`
	}

	query += ` ORDER BY created_at DESC LIMIT $3 OFFSET $4`
	args = append(args, limit, offset)

	rows, err := r.store.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query notifications: %w", err)
	}
	defer rows.Close()

	var result []*notifications.Notification
	for rows.Next() {
		var n notifications.Notification
		var commentID, actorID sql.NullString
		var readAt sql.NullTime

		if err := rows.Scan(
			&n.ID, &n.UserID, &n.Type, &n.Reason, &n.IssueID,
			&n.Repository, &n.IssueNumber, &n.IssueTitle,
			&commentID, &actorID, &n.Unread, &n.CreatedAt, &readAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan notification: %w", err)
		}

		if commentID.Valid {
			n.CommentID = commentID.String
		}
		if actorID.Valid {
			n.ActorID = actorID.String
		}
		if readAt.Valid {
			n.ReadAt = &readAt.Time
		}

		result = append(result, &n)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate notifications: %w", err)
	}

	return result, total, nil
}

// MarkAsRead marks a notification as read
func (r *NotificationRepository) MarkAsRead(ctx context.Context, organizationID string, notificationID notifications.ID, userID string) error {
	now := time.Now().UTC()

	result, err := r.store.pool.Exec(ctx, `
		UPDATE notifications
		SET unread = false, read_at = $1
		WHERE organization_id = $2 AND id = $3 AND user_id = $4 AND unread = true
	`, now, organizationID, notificationID, userID)

	if err != nil {
		return fmt.Errorf("mark notification as read: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("notification not found or already read")
	}

	return nil
}

// MarkAllAsRead marks all notifications for a user as read
func (r *NotificationRepository) MarkAllAsRead(ctx context.Context, organizationID string, userID string) error {
	now := time.Now().UTC()

	_, err := r.store.pool.Exec(ctx, `
		UPDATE notifications
		SET unread = false, read_at = $1
		WHERE organization_id = $2 AND user_id = $3 AND unread = true
	`, now, organizationID, userID)

	if err != nil {
		return fmt.Errorf("mark all notifications as read: %w", err)
	}

	return nil
}

// Delete removes a notification
func (r *NotificationRepository) Delete(ctx context.Context, organizationID string, notificationID notifications.ID, userID string) error {
	result, err := r.store.pool.Exec(ctx, `
		DELETE FROM notifications
		WHERE organization_id = $1 AND id = $2 AND user_id = $3
	`, organizationID, notificationID, userID)

	if err != nil {
		return fmt.Errorf("delete notification: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("notification not found")
	}

	return nil
}

// Subscribe adds a subscription for a user to an issue
func (r *NotificationRepository) Subscribe(ctx context.Context, organizationID string, userID string, issueID string) error {
	_, err := r.store.pool.Exec(ctx, `
		INSERT INTO issue_subscriptions (organization_id, issue_id, user_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (organization_id, issue_id, user_id) DO NOTHING
	`, organizationID, issueID, userID)

	if err != nil {
		return fmt.Errorf("subscribe to issue: %w", err)
	}

	return nil
}

// Unsubscribe removes a subscription for a user from an issue
func (r *NotificationRepository) Unsubscribe(ctx context.Context, organizationID string, userID string, issueID string) error {
	result, err := r.store.pool.Exec(ctx, `
		DELETE FROM issue_subscriptions
		WHERE organization_id = $1 AND issue_id = $2 AND user_id = $3
	`, organizationID, issueID, userID)

	if err != nil {
		return fmt.Errorf("unsubscribe from issue: %w", err)
	}

	if result.RowsAffected() == 0 {
		return fmt.Errorf("subscription not found")
	}

	return nil
}

// IsSubscribed checks if a user is subscribed to an issue
func (r *NotificationRepository) IsSubscribed(ctx context.Context, organizationID string, userID string, issueID string) (bool, error) {
	var exists bool
	err := r.store.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM issue_subscriptions
			WHERE organization_id = $1 AND issue_id = $2 AND user_id = $3
		)
	`, organizationID, issueID, userID).Scan(&exists)

	if err != nil {
		return false, fmt.Errorf("check subscription: %w", err)
	}

	return exists, nil
}

// GetSubscribers returns all subscribers for an issue
func (r *NotificationRepository) GetSubscribers(ctx context.Context, organizationID string, issueID string) ([]string, error) {
	rows, err := r.store.pool.Query(ctx, `
		SELECT user_id
		FROM issue_subscriptions
		WHERE organization_id = $1 AND issue_id = $2
		ORDER BY subscribed_at ASC
	`, organizationID, issueID)

	if err != nil {
		return nil, fmt.Errorf("query subscribers: %w", err)
	}
	defer rows.Close()

	var subscribers []string
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, fmt.Errorf("scan subscriber: %w", err)
		}
		subscribers = append(subscribers, userID)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate subscribers: %w", err)
	}

	return subscribers, nil
}
