package issues

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrProjectNameInUse = errors.New("project name already exists in this scope")
	ErrProjectNotFound  = errors.New("project, item or source not found")
	ErrProjectConflict  = errors.New("project or item version conflict")
	ErrProjectClosed    = errors.New("project is closed")
	ErrProjectInvalid   = errors.New("invalid project repository or item operation")
)

type ProjectLayout string

const (
	ProjectTable   ProjectLayout = "table"
	ProjectBoard   ProjectLayout = "board"
	ProjectRoadmap ProjectLayout = "roadmap"
)

func (l ProjectLayout) Valid() bool {
	return l == ProjectTable || l == ProjectBoard || l == ProjectRoadmap
}

type ProjectView struct {
	ID     string        `json:"id"`
	Name   string        `json:"name"`
	Layout ProjectLayout `json:"layout"`
	Filter string        `json:"filter"`
	Sort   string        `json:"sort"`
	Group  string        `json:"group"`
}

// ProjectRef is the legacy lightweight reference embedded in Issue responses.
type ProjectRef struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Number     int    `json:"number"`
	Repository string `json:"repository,omitempty"`
}

type ProjectAutoAdd struct {
	Repository string `json:"repository"`
	Kind       string `json:"kind"`
	LabelID    string `json:"label_id,omitempty"`
}

type ProjectWorkflows struct {
	ItemAdded         string          `json:"item_added"`
	IssueClosed       string          `json:"issue_closed"`
	PullRequestClosed string          `json:"pull_request_closed"`
	PullRequestMerged string          `json:"pull_request_merged"`
	AutoArchiveDays   int             `json:"auto_archive_days,omitempty"`
	AutoAdd           *ProjectAutoAdd `json:"auto_add,omitempty"`
}

func (w ProjectWorkflows) Valid() bool {
	if a := w.AutoAdd; a != nil && (a.Repository == "" || (a.Kind != "issue" && a.Kind != "pull_request") || (a.Kind == "pull_request" && a.LabelID != "")) {
		return false
	}
	valid := func(status string) bool { return status == "todo" || status == "in_progress" || status == "done" }
	return w.AutoArchiveDays >= 0 && w.AutoArchiveDays <= 365 && valid(w.ItemAdded) &&
		(w.IssueClosed == "" || valid(w.IssueClosed)) &&
		(w.PullRequestClosed == "" || valid(w.PullRequestClosed)) &&
		(w.PullRequestMerged == "" || valid(w.PullRequestMerged))
}

type Project struct {
	ID                string           `json:"id"`
	Name              string           `json:"name"`
	Repository        string           `json:"repository,omitempty"`
	Recent            bool             `json:"recent,omitempty"`
	Number            int              `json:"number"`
	Layout            ProjectLayout    `json:"layout"`
	DefaultRepository string           `json:"default_repository,omitempty"`
	CreatedAt         *time.Time       `json:"created_at,omitempty"`
	UpdatedAt         time.Time        `json:"updated_at"`
	Description       string           `json:"description"`
	Readme            string           `json:"readme"`
	Closed            bool             `json:"closed"`
	Version           int64            `json:"version"`
	Repositories      []string         `json:"repositories"`
	Views             []ProjectView    `json:"views"`
	Workflows         ProjectWorkflows `json:"workflows"`
}

type ProjectPatch struct {
	Name              *string           `json:"name"`
	Description       *string           `json:"description"`
	Readme            *string           `json:"readme"`
	Closed            *bool             `json:"closed"`
	DefaultRepository *string           `json:"default_repository"`
	Repositories      *[]string         `json:"repositories"`
	Views             *[]ProjectView    `json:"views"`
	Version           int64             `json:"version"`
	Workflows         *ProjectWorkflows `json:"workflows"`
}

type ProjectItem struct {
	ID          string                     `json:"id"`
	Kind        string                     `json:"kind"`
	Title       string                     `json:"title"`
	DraftBody   string                     `json:"draft_body,omitempty"`
	Repository  string                     `json:"repository"`
	Number      int                        `json:"number"`
	SourceID    string                     `json:"source_id,omitempty"`
	Status      string                     `json:"status"`
	Priority    string                     `json:"priority"`
	StartDate   string                     `json:"start_date"`
	TargetDate  string                     `json:"target_date"`
	Iteration   string                     `json:"iteration"`
	Archived    bool                       `json:"archived"`
	Version     int64                      `json:"version"`
	FieldValues map[string]json.RawMessage `json:"field_values,omitempty"`
}

type ProjectItemInput struct {
	Kind       string  `json:"kind"`
	Title      string  `json:"title"`
	DraftBody  *string `json:"draft_body"`
	Repository string  `json:"repository"`
	Number     int32   `json:"number"`
	SourceID   string  `json:"source_id"`
	Status     *string `json:"status"`
	Priority   *string `json:"priority"`
}

type ProjectItemPatch struct {
	Title      *string `json:"title"`
	DraftBody  *string `json:"draft_body"`
	Status     *string `json:"status"`
	Priority   *string `json:"priority"`
	StartDate  *string `json:"start_date"`
	TargetDate *string `json:"target_date"`
	Iteration  *string `json:"iteration"`
	Archived   *bool   `json:"archived"`
	Version    int64   `json:"version"`
}

type ProjectStatusDay struct {
	Date       string `json:"date"`
	Todo       int64  `json:"todo"`
	InProgress int64  `json:"in_progress"`
	Done       int64  `json:"done"`
}

type ProjectWorkflowRun struct {
	ID         string    `json:"id"`
	Rule       string    `json:"rule"`
	ItemCount  int       `json:"item_count"`
	OccurredAt time.Time `json:"occurred_at"`
}

type ProjectRepository interface {
	ListProjectWorkflowRuns(ctx context.Context, organizationID string, number int) ([]ProjectWorkflowRun, error)
	ProjectStatusHistory(ctx context.Context, organizationID string, number int) ([]ProjectStatusDay, error)
	ListIssueProjects(ctx context.Context, organizationID, repository, linkedRepository, actorID string) ([]Project, error)
	CreateIssueProject(ctx context.Context, organizationID string, project Project) (Project, error)
	GetIssueProject(ctx context.Context, organizationID string, number int, actorID string) (Project, error)
	PatchIssueProject(ctx context.Context, organizationID string, number int, actorID string, patch ProjectPatch) (Project, error)
	DeleteIssueProject(ctx context.Context, organizationID string, number int, version int64) error
	ListProjectItems(ctx context.Context, organizationID string, number int, archived bool) ([]ProjectItem, error)
	AddProjectItem(ctx context.Context, organizationID string, number int, input ProjectItemInput) (ProjectItem, bool, error)
	PatchProjectItem(ctx context.Context, organizationID string, number int, id string, patch ProjectItemPatch) (ProjectItem, error)
	DeleteProjectItem(ctx context.Context, organizationID string, number int, id string, version int64) error
	ConvertProjectItem(ctx context.Context, organizationID string, number int, id string, version int64, issue *Issue) (ProjectItem, error)
	ListProjectUpdates(ctx context.Context, organizationID string, number int) ([]ProjectUpdate, error)
	CreateProjectUpdate(ctx context.Context, organizationID string, number int, actorID string, input ProjectUpdateInput) (ProjectUpdate, error)
}
