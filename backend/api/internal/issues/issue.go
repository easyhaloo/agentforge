package issues

import (
	"errors"
	"time"
)

var ErrStateConflict = errors.New("issue state has changed")
var ErrInvalidMetadata = errors.New("issue metadata is invalid")
var ErrInvalidAttachments = errors.New("issue attachments are unavailable")
var ErrAttachmentQuota = errors.New("issue attachment draft quota reached")
var ErrAttachmentNotFound = errors.New("issue attachment not found")

// AttachmentDraft holds the bytes and ownership of an uploaded file.
type AttachmentDraft struct {
	ID          string
	Repository  string
	UploaderID  string
	Filename    string
	ContentType string
	Content     []byte
}

// ID is a unique identifier for an issue
type ID string

// State represents the issue state
type State string

const (
	StateOpen   State = "open"
	StateClosed State = "closed"
)

type Type string

func (value Type) Valid() bool {
	switch value {
	case "", "task", "bug", "feature":
		return true
	default:
		return false
	}
}

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
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name,omitempty"`
}

type ChangesetLink struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type PullRequestLink struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Repository string `json:"repository"`
}

type MetadataUpdate struct {
	Fields       map[string]string `json:"custom_fields,omitempty"`
	ChangesetIDs []string          `json:"changeset_ids,omitempty"`
	AssigneeIDs  []string          `json:"assignees,omitempty"`
	LabelIDs     []string          `json:"label_ids,omitempty"`
	ProjectIDs   []string          `json:"project_ids,omitempty"`
	MilestoneID  *string           `json:"milestone_id,omitempty"`
	Type         *Type             `json:"issue_type,omitempty"`
}

func (m MetadataUpdate) HasChanges() bool {
	return m.Fields != nil || m.ChangesetIDs != nil || m.AssigneeIDs != nil || m.LabelIDs != nil || m.ProjectIDs != nil || m.MilestoneID != nil || m.Type != nil
}

type CommitLink struct {
	SHA     string `json:"sha"`
	Subject string `json:"subject"`
}

// Issue represents a trackable unit of work or discussion.
type Issue struct {
	ClosingPullRequests []PullRequestLink `json:"closing_pull_requests,omitempty"`
	Commits             []CommitLink      `json:"commits,omitempty"`
	Fields              map[string]string `json:"custom_fields,omitempty"`
	Changesets          []ChangesetLink   `json:"changesets,omitempty"`
	CreatedByName       string            `json:"created_by_name,omitempty"`
	ID                  ID                `json:"id"`
	Number              int               `json:"number"`
	Repository          string            `json:"repository"`
	Title               string            `json:"title"`
	Body                string            `json:"body"`
	Type                Type              `json:"issue_type,omitempty"`
	AttachmentIDs       []string          `json:"-"`
	ParentNumber        int               `json:"-"`
	ParentCanManage     bool              `json:"-"`
	MetadataUpdate      MetadataUpdate    `json:"-"`
	ProjectIDs          []string          `json:"-"`
	Projects            []Project         `json:"projects,omitempty"`
	State               State             `json:"state"`
	StateReason         StateReason       `json:"state_reason,omitempty"`
	MilestoneID         string            `json:"milestone_id,omitempty"`
	MilestoneTitle      string            `json:"milestone_title,omitempty"`
	CommentsCount       int               `json:"comments"`
	Labels              []Label           `json:"labels"`
	Assignees           []Assignee        `json:"assignees"`
	Locked              bool              `json:"locked"`
	LockReason          LockReason        `json:"lock_reason,omitempty"`
	LockedAt            *time.Time        `json:"locked_at,omitempty"`
	LockedBy            string            `json:"locked_by,omitempty"`
	CreatedBy           string            `json:"created_by"`
	CreatedAt           time.Time         `json:"created_at"`
	UpdatedAt           time.Time         `json:"updated_at"`
	ExpectedUpdatedAt   *time.Time        `json:"-"`
	EditorID            string            `json:"-"`
	ClosedAt            *time.Time        `json:"closed_at,omitempty"`
	ClosedBy            string            `json:"closed_by,omitempty"`
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
