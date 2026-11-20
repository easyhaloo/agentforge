package comments

import (
	"time"
)

// ID is a unique identifier (can represent Comment ID or parent Resource ID)
type ID string

// ResourceType represents the type of resource a comment belongs to
type ResourceType string

const (
	ResourceTypeIssue     ResourceType = "issue"
	ResourceTypeChangeset ResourceType = "changeset"
)

// MinimizedReason represents why a comment was minimized (collapsed)
type MinimizedReason string

const (
	ReasonSpam     MinimizedReason = "spam"
	ReasonOffTopic MinimizedReason = "off-topic"
	ReasonOutdated MinimizedReason = "outdated"
	ReasonResolved MinimizedReason = "resolved"
)

// Comment represents a comment on an Issue or Changeset
type Comment struct {
	ID              ID
	ResourceType    ResourceType
	ResourceID      ID // ID of the parent resource (Issue or Changeset)
	Body            string
	AuthorID        string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	EditedAt        *time.Time
	Minimized       bool
	MinimizedReason MinimizedReason
	Version         int64 // Optimistic locking version
}
