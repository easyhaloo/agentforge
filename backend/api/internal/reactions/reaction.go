package reactions

import (
	"time"
)

// ID is a unique identifier (can represent Reaction ID or reactable Resource ID)
type ID string

// ReactableType represents the type of resource a reaction belongs to
type ReactableType string

const (
	ReactableTypeIssue   ReactableType = "issue"
	ReactableTypeComment ReactableType = "comment"
)

// Content represents the emoji/reaction content (GitHub's 8 supported reactions)
type Content string

const (
	ContentThumbsUp   Content = "+1"
	ContentThumbsDown Content = "-1"
	ContentLaugh      Content = "laugh"
	ContentConfused   Content = "confused"
	ContentHeart      Content = "heart"
	ContentHooray     Content = "hooray"
	ContentRocket     Content = "rocket"
	ContentEyes       Content = "eyes"
)

// Reaction represents a user's emoji reaction to an Issue or Comment
type Reaction struct {
	ID            ID
	ReactableType ReactableType
	ReactableID   ID // ID of the parent resource (Issue or Comment)
	UserID        string
	Content       Content
	CreatedAt     time.Time
}
