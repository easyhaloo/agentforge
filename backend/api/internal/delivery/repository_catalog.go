package delivery

import (
	"context"
	"errors"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

var ErrNoRepositoryMergeMethod = errors.New("enable at least one pull request merge method")

type RepositoryMetadata struct {
	githttp.MergeMethods
	githttp.MergeMessageFormats
	OrganizationID           string            `json:"organization_id"`
	Slug                     string            `json:"slug"`
	Description              string            `json:"description,omitempty"`
	DefaultBranch            string            `json:"default_branch"`
	Visibility               string            `json:"visibility,omitempty"`
	Fork                     bool              `json:"fork"`
	WebCommitSignoffRequired bool              `json:"web_commit_signoff_required"`
	SuggestBranchUpdate      bool              `json:"suggest_branch_update"`
	DeleteMergedBranches     bool              `json:"delete_merged_branches"`
	AutoCloseIssuesDisabled  bool              `json:"auto_close_issues_disabled"`
	IssuesDisabled           bool              `json:"issues_disabled"`
	ActionsRetentionDays     int               `json:"actions_retention_days"`
	ActionsDisabled          bool              `json:"actions_disabled"`
	IsTemplate               bool              `json:"is_template"`
	PushRefLimit             int               `json:"push_ref_limit"`
	ProtectedRefs            []string          `json:"protected_refs,omitempty"`
	RefRules                 []githttp.RefRule `json:"ref_rules,omitempty"`
	CreatedBy                string            `json:"created_by"`
	CreatedAt                time.Time         `json:"created_at"`
	UpdatedAt                time.Time         `json:"updated_at"`
}

type RepositoryActivity struct {
	Slug           string `json:"-"`
	ChangesetCount int    `json:"changeset_count"`
	ActionCount    int    `json:"action_count"`
}

type RepositoryAction struct {
	ID          string     `json:"id"`
	Pipeline    string     `json:"pipeline"`
	Status      string     `json:"status"`
	Version     int        `json:"version"`
	CreatedAt   time.Time  `json:"created_at"`
	PipelineID  string     `json:"pipeline_id"`
	Event       string     `json:"event"`
	Branch      string     `json:"branch,omitempty"`
	SHA         string     `json:"sha,omitempty"`
	Actor       string     `json:"actor"`
	ActorID     string     `json:"actor_id"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

type RepositoryActionFilter struct {
	Workflow string
	Status   string
	Event    string
	Query    string
	Branch   string
	Actor    string
}

type RepositoryCatalog interface {
	RegisterRepository(context.Context, RepositoryMetadata) (RepositoryMetadata, error)
	ListRepositories(context.Context, string) ([]RepositoryMetadata, error)
}
