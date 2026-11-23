package events

import (
	"time"
)

// ID is a unique identifier for an event
type ID string

// EventType represents the type of event that occurred
type EventType string

const (
	// Issue lifecycle events
	EventCreated  EventType = "created"
	EventClosed   EventType = "closed"
	EventReopened EventType = "reopened"

	// Label events
	EventLabeled   EventType = "labeled"
	EventUnlabeled EventType = "unlabeled"

	// Assignee events
	EventAssigned   EventType = "assigned"
	EventUnassigned EventType = "unassigned"

	// Milestone events
	EventMilestoned   EventType = "milestoned"
	EventDemilestoned EventType = "demilestoned"

	// Content events
	EventRenamed EventType = "renamed"
	EventEdited  EventType = "edited"

	// Lock events
	EventLocked   EventType = "locked"
	EventUnlocked EventType = "unlocked"

	// Changeset link events
	EventLinkedChangeset   EventType = "linked_changeset"
	EventUnlinkedChangeset EventType = "unlinked_changeset"

	// Interaction events
	EventCommented  EventType = "commented"
	EventMentioned  EventType = "mentioned"
	EventReferenced EventType = "referenced"
)

// Event represents a timeline event for an issue
type Event struct {
	ID        ID                     `json:"id"`
	IssueID   string                 `json:"issue_id"`
	EventType EventType              `json:"event_type"`
	ActorID   string                 `json:"actor_id"` // User who performed the action (may be empty for system events)
	Metadata  map[string]interface{} `json:"metadata"` // Additional event-specific data
	CreatedAt time.Time              `json:"created_at"`
}
