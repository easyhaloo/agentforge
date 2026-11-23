package comments

import (
	"errors"
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

var ErrLocked = errors.New("issue conversation locked")
var ErrVersionConflict = errors.New("comment version conflict")

// Comment represents a comment on an Issue or Changeset
type Comment struct {
	ID              ID              `json:"id"`
	ResourceType    ResourceType    `json:"resource_type"`
	ResourceID      ID              `json:"resource_id"` // ID of the parent resource (Issue or Changeset)
	Body            string          `json:"body"`
	AuthorID        string          `json:"author_id"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	EditedAt        *time.Time      `json:"edited_at,omitempty"`
	Minimized       bool            `json:"minimized"`
	MinimizedReason MinimizedReason `json:"minimized_reason,omitempty"`
	Version         int64           `json:"version"` // Optimistic locking version
	AllowLocked     bool            `json:"-"`
}
