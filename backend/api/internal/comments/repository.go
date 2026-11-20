package comments

import (
	"context"
)

// Repository defines the persistence interface for comments
type Repository interface {
	// Create persists a new comment and increments the parent resource's comments_count
	Create(ctx context.Context, organizationID string, comment *Comment) (*Comment, error)

	// List retrieves all comments for a specific resource, ordered by created_at ASC
	List(ctx context.Context, organizationID string, resourceType ResourceType, resourceID ID) ([]*Comment, error)

	// Get retrieves a single comment by ID
	Get(ctx context.Context, organizationID string, commentID ID) (*Comment, error)

	// Update updates a comment's body and sets edited_at timestamp
	Update(ctx context.Context, organizationID string, comment *Comment) (*Comment, error)

	// Delete removes a comment and decrements the parent resource's comments_count
	Delete(ctx context.Context, organizationID string, commentID ID) error

	// Minimize collapses a comment with a specific reason
	Minimize(ctx context.Context, organizationID string, commentID ID, reason MinimizedReason) (*Comment, error)

	// Unminimize restores a minimized comment to normal display
	Unminimize(ctx context.Context, organizationID string, commentID ID) (*Comment, error)
}
