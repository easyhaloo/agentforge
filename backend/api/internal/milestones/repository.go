package milestones

import (
	"context"
	"time"
)

// Repository defines the persistence interface for milestones
type Repository interface {
	// Create persists a new milestone
	Create(ctx context.Context, organizationID string, milestone *Milestone) (*Milestone, error)

	// Get retrieves a milestone by ID
	Get(ctx context.Context, organizationID string, milestoneID ID) (*Milestone, error)

	// List retrieves milestones for a repository
	List(ctx context.Context, organizationID, repository string, state State) ([]*Milestone, error)

	// Update updates an existing milestone
	Update(ctx context.Context, organizationID string, milestone *Milestone) (*Milestone, error)

	// Delete removes a milestone
	Delete(ctx context.Context, organizationID string, milestoneID ID) error

	// Close closes a milestone
	Close(ctx context.Context, organizationID string, milestoneID ID, closedAt time.Time) (*Milestone, error)

	// SetMilestone associates an issue with a milestone
	SetMilestone(ctx context.Context, organizationID, issueID, milestoneID string) error

	// ClearMilestone removes the milestone association from an issue
	ClearMilestone(ctx context.Context, organizationID, issueID string) error

	// GetProgress retrieves milestone completion statistics
	GetProgress(ctx context.Context, organizationID string, milestoneID ID) (*Progress, error)
}
