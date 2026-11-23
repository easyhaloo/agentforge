package issues

import (
	"errors"
	"time"
)

var ErrStateConflict = errors.New("issue state has changed")

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

// LockReason represents why an issue was locked
type LockReason string

const (
	LockReasonOffTopic  LockReason = "off-topic"
	LockReasonTooHeated LockReason = "too heated"
	LockReasonResolved  LockReason = "resolved"
	LockReasonSpam      LockReason = "spam"
)

type Label struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Color       string    `json:"color"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Assignee struct {
	UserID string `json:"user_id"`
}

// Issue represents a trackable unit of work or discussion.
type Issue struct {
	ID            ID          `json:"id"`
	Number        int         `json:"number"`
	Repository    string      `json:"repository"`
	Title         string      `json:"title"`
	Body          string      `json:"body"`
	State         State       `json:"state"`
	StateReason   StateReason `json:"state_reason,omitempty"`
	MilestoneID   string      `json:"milestone_id,omitempty"`
	CommentsCount int         `json:"comments"`
	Labels        []Label     `json:"labels"`
	Assignees     []Assignee  `json:"assignees"`
	Locked        bool        `json:"locked"`
	LockReason    LockReason  `json:"lock_reason,omitempty"`
	LockedAt      *time.Time  `json:"locked_at,omitempty"`
	LockedBy      string      `json:"locked_by,omitempty"`
	CreatedBy     string      `json:"created_by"`
	CreatedAt     time.Time   `json:"created_at"`
	UpdatedAt     time.Time   `json:"updated_at"`
	ClosedAt      *time.Time  `json:"closed_at,omitempty"`
	ClosedBy      string      `json:"closed_by,omitempty"`
}

type ListFilter struct {
	State      State
	CreatedBy  string
	Repository string
	Assignee   string
	Label      string
	Milestone  string
	Query      string
	Since      *time.Time
	Sort       string
	Direction  string
}

type ListCounts struct {
	Total       int `json:"total"`
	OpenTotal   int `json:"open_total"`
	ClosedTotal int `json:"closed_total"`
}

type FilterOptions struct {
	Authors    []string `json:"authors"`
	Labels     []string `json:"labels"`
	Assignees  []string `json:"assignees"`
	Milestones []string `json:"milestones"`
}
