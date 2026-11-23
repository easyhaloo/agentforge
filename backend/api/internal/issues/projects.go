package issues

import (
	"context"
	"errors"
)

var ErrProjectNameInUse = errors.New("project name already exists in this scope")

// Project is an organization-wide or repository-scoped issue grouping.
type Project struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Repository string `json:"repository,omitempty"`
	Recent     bool   `json:"recent,omitempty"`
	Number     int    `json:"number"`
}

type ProjectRepository interface {
	ListIssueProjects(ctx context.Context, organizationID, repository, actorID string) ([]Project, error)
	CreateIssueProject(ctx context.Context, organizationID string, project Project) (int, error)
}
