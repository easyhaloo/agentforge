package reactions

import (
	"context"
)

// Repository defines the persistence interface for reactions
type Repository interface {
	// Add creates a new reaction
	// Returns error if the same user already reacted with the same emoji (uniqueness constraint)
	Add(ctx context.Context, organizationID string, reaction *Reaction) (*Reaction, error)

	// List retrieves all reactions for a specific resource
	List(ctx context.Context, organizationID string, reactableType ReactableType, reactableID ID) ([]*Reaction, error)

	// Remove deletes a reaction by ID
	Remove(ctx context.Context, organizationID string, reactionID ID) error
}
