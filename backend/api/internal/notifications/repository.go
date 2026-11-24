package notifications

import (
	"context"
)

// Repository defines the persistence interface for notifications
type Repository interface {
	IsWatchingRepository(ctx context.Context, organizationID, repository, userID string) (bool, error)
	SetRepositoryWatch(ctx context.Context, organizationID, repository, userID string, watching bool) error

	// Create persists a new notification
	Create(ctx context.Context, organizationID string, notification *Notification) error

	// List retrieves notifications for a user
	List(ctx context.Context, organizationID string, userID string, unreadOnly bool, limit, offset int) ([]*Notification, int, error)

	// MarkAsRead marks a notification as read
	MarkAsRead(ctx context.Context, organizationID string, notificationID ID, userID string) error

	// MarkAllAsRead marks all notifications for a user as read
	MarkAllAsRead(ctx context.Context, organizationID string, userID string) error

	// Delete removes a notification
	Delete(ctx context.Context, organizationID string, notificationID ID, userID string) error

	// Subscribe adds a subscription for a user to an issue
	Subscribe(ctx context.Context, organizationID string, userID string, issueID string) error

	// Unsubscribe removes a subscription for a user from an issue
	Unsubscribe(ctx context.Context, organizationID string, userID string, issueID string) error

	// IsSubscribed checks if a user is subscribed to an issue
	IsSubscribed(ctx context.Context, organizationID string, userID string, issueID string) (bool, error)

	// GetSubscribers returns all subscribers for an issue
	GetSubscribers(ctx context.Context, organizationID string, issueID string) ([]string, error)
}
