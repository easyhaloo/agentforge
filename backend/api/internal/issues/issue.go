package issues

import (
	"time"
)

// ID is a unique identifier for an issue
type ID string

// State represents the issue state
type State string

const (
	StateOpen   State = "open"
	StateClosed State = "closed"
)

// StateReason represents why an issue was closed
type StateReason string

const (
	ReasonCompleted  StateReason = "completed"
	ReasonNotPlanned StateReason = "not_planned"
	ReasonDuplicate  StateReason = "duplicate"
)

// Issue represents a trackable unit of work or discussion
type Issue struct {
	ID          ID
	Number      int
	Repository  string
	Title       string
	Body        string
	State       State
	StateReason StateReason
	CreatedBy   string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ClosedAt    *time.Time
	ClosedBy    string
}

// ListFilter represents filtering criteria for issues
type ListFilter struct {
	State      State      // Filter by state (open/closed)
	CreatedBy  string     // Filter by creator
	Repository string     // Filter by repository
	Query      string     // Full-text search in title and body
	Since      *time.Time // Filter by updated_at >= since
}
