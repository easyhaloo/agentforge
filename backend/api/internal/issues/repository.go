package issues

import (
	"context"
)

// Repository defines the persistence interface for issues
type Repository interface {
	// Create persists a new issue and allocates a sequential number
	Create(ctx context.Context, organizationID string, issue *Issue) (*Issue, error)

	// Get retrieves an issue by repository and number
	Get(ctx context.Context, organizationID, repository string, number int) (*Issue, error)

	// List retrieves issues with filtering, pagination, and sorting
	List(ctx context.Context, organizationID string, filter ListFilter, limit, offset int) ([]*Issue, int, error)
}
