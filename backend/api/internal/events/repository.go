package events

import (
	"context"
)

// Repository defines the persistence interface for issue events
type Repository interface {
	// Record persists a new event in the timeline
	Record(ctx context.Context, organizationID string, event *Event) error

	// List retrieves all events for an issue in chronological order
	List(ctx context.Context, organizationID string, issueID string) ([]*Event, error)

	// ListByType retrieves events of a specific type for an issue
	ListByType(ctx context.Context, organizationID string, issueID string, eventType EventType) ([]*Event, error)
}
