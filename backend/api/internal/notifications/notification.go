package notifications

import (
	"time"
)

// ID is a unique identifier for a notification
type ID string

// Type represents the type of notification
type Type string

const (
	// TypeComment indicates a new comment on a subscribed issue
	TypeComment Type = "comment"

	// TypeMention indicates the user was mentioned in an issue or comment
	TypeMention Type = "mention"

	// TypeStateChange indicates a state change on a subscribed issue
	TypeStateChange Type = "state_change"

	// TypeAssigned indicates the user was assigned to an issue
	TypeAssigned Type = "assigned"
)

// Reason describes why a notification was generated
type Reason string

const (
	ReasonSubscribed Reason = "subscribed" // User is subscribed to the issue
	ReasonMentioned  Reason = "mentioned"  // User was mentioned
	ReasonAuthor     Reason = "author"     // User is the issue author
	ReasonAssigned   Reason = "assigned"   // User is assigned to the issue
	ReasonComment    Reason = "comment"    // User commented on the issue
)

// Notification represents a notification for a user
type Notification struct {
	ID          ID         `json:"id"`
	UserID      string     `json:"user_id"`
	Type        Type       `json:"type"`
	Reason      Reason     `json:"reason"`
	IssueID     string     `json:"issue_id"`
	Repository  string     `json:"repository"`
	IssueNumber int        `json:"issue_number"`
	IssueTitle  string     `json:"issue_title"`
	CommentID   string     `json:"comment_id,omitempty"` // Optional: set if notification is about a specific comment
	ActorID     string     `json:"actor_id,omitempty"`   // User who triggered the notification
	Unread      bool       `json:"unread"`
	CreatedAt   time.Time  `json:"created_at"`
	ReadAt      *time.Time `json:"read_at,omitempty"`
}
