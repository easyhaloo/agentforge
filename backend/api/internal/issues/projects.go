package issues

import (
	"context"
	"errors"
	"time"
)

var ErrProjectNameInUse = errors.New("project name already exists in this scope")

// Project is an organization-wide or repository-scoped issue grouping.
type ProjectLayout string

const (
	ProjectTable ProjectLayout = "table"
	ProjectBoard ProjectLayout = "board"
)

type Project struct {
	ID                string        `json:"id"`
	Name              string        `json:"name"`
	Repository        string        `json:"repository,omitempty"`
	Recent            bool          `json:"recent,omitempty"`
	Number            int           `json:"number"`
	Layout            ProjectLayout `json:"layout,omitempty"`
	DefaultRepository string        `json:"default_repository,omitempty"`
	CreatedAt         *time.Time    `json:"created_at,omitempty"`
}

type ProjectRepository interface {
	ListIssueProjects(ctx context.Context, organizationID, repository, actorID string) ([]Project, error)
	CreateIssueProject(ctx context.Context, organizationID string, project Project) (Project, error)
}
