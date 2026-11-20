package milestones

import (
	"time"
)

// ID is a unique identifier for a milestone
type ID string

// State represents the milestone state
type State string

const (
	StateOpen   State = "open"
	StateClosed State = "closed"
)

// Milestone represents a collection of issues with a common goal or deadline
type Milestone struct {
	ID          ID
	Repository  string
	Title       string
	Description string
	DueOn       *time.Time
	State       State
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ClosedAt    *time.Time
}

// Progress represents milestone completion statistics
type Progress struct {
	OpenIssues   int
	ClosedIssues int
	TotalIssues  int
	Percentage   float64
}
