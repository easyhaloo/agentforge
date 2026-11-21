package issues

import (
	"context"
	"time"
)

// Repository defines the persistence interface for issues
type Repository interface {
	// Create persists a new issue and allocates a sequential number
	Create(ctx context.Context, organizationID string, issue *Issue) (*Issue, error)

	// Get retrieves an issue by repository and number
	Get(ctx context.Context, organizationID, repository string, number int) (*Issue, error)

	// List retrieves issues with filtering, pagination, and sorting
	List(ctx context.Context, organizationID string, filter ListFilter, limit, offset int) ([]*Issue, int, error)

	// Update updates an existing issue (title, body, state, etc.)
	Update(ctx context.Context, organizationID string, issue *Issue) (*Issue, error)

	// Close closes an issue with a specific reason
	Close(ctx context.Context, organizationID string, issueID ID, reason StateReason, closedBy string, closedAt time.Time) (*Issue, error)

	// AddAssignee assigns a user to an issue (idempotent)
	AddAssignee(ctx context.Context, organizationID string, issueID string, userID string) error

	// RemoveAssignee unassigns a user from an issue
	RemoveAssignee(ctx context.Context, organizationID string, issueID string, userID string) error

	// GetAssignees retrieves all assignees for an issue
	GetAssignees(ctx context.Context, organizationID string, issueID string) ([]string, error)

	// Lock locks an issue to prevent new comments
	Lock(ctx context.Context, organizationID string, issueID ID, reason LockReason, lockedBy string, lockedAt time.Time) (*Issue, error)

	// Unlock unlocks an issue to allow new comments
	Unlock(ctx context.Context, organizationID string, issueID ID) (*Issue, error)
}
