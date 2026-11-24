package issues

import (
	"context"
	"errors"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
)

var (
	ErrSourceConflict   = errors.New("GitHub issue source changed")
	ErrTransferConflict = errors.New("issue changed before transfer")
	ErrTransferRelated  = errors.New("issue has repository-scoped family relationships")
	ErrDetailNotFound   = errors.New("issue detail resource not found")
	ErrDetailForbidden  = errors.New("issue detail operation forbidden")
	ErrParentCycle      = errors.New("issue parent would introduce a cycle")
	ErrParentExists     = errors.New("issue already has a different parent")
	ErrArtifactLimit    = errors.New("issue artifact limit reached")
	ErrDuplicateReport  = errors.New("content already reported by this user")
)

// DetailScope is resolved from the trusted organization principal and registered repository.
type DetailScope struct {
	OrganizationID, Repository, UserID string
	Number                             int
	CanManage                          bool
}

type IssueSummary struct {
	ID     ID     `json:"id"`
	Number int    `json:"number"`
	Title  string `json:"title"`
	State  State  `json:"state"`
}

type Relationships struct {
	Parent   *IssueSummary  `json:"parent"`
	Children []IssueSummary `json:"children"`
}

type Artifact struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Size        int    `json:"size"`
	URL         string `json:"url"`
}

type ReportReceipt struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
}

// GitHubSource is a snapshot of a linked public GitHub issue and its cross-references.
type GitHubSource struct {
	URL        string            `json:"url"`
	FetchedAt  time.Time         `json:"fetched_at"`
	References []GitHubReference `json:"references"`
}

type GitHubReference struct {
	URL       string    `json:"url"`
	Actor     string    `json:"actor"`
	Title     string    `json:"title"`
	Number    int       `json:"number"`
	CreatedAt time.Time `json:"created_at"`
}

type DetailRepository interface {
	GitHubSource(context.Context, DetailScope) (*GitHubSource, error)
	SetGitHubSource(ctx context.Context, scope DetailScope, source *GitHubSource, expected string) error
	CreateBranch(ctx context.Context, scope DetailScope, write func(ID, delivery.BranchWriteCheck) (delivery.RepositoryRef, error)) (delivery.RepositoryRef, error)
	CreateLinkedPullRequest(ctx context.Context, scope DetailScope, changeset *delivery.Changeset) (delivery.StoredChangeset, error)
	MovedIssue(ctx context.Context, organizationID, repository string, number int) (*Issue, error)
	Transfer(ctx context.Context, scope DetailScope, destination string, expected time.Time) (*Issue, error)
	Relationships(context.Context, DetailScope) (Relationships, error)
	SetParent(ctx context.Context, scope DetailScope, parentNumber int) (Relationships, error)
	Artifacts(context.Context, DetailScope) ([]Artifact, error)
	SetArtifact(ctx context.Context, scope DetailScope, attachmentID string, linked bool) error
	Report(ctx context.Context, scope DetailScope, id, commentID, reason, details string) (ReportReceipt, error)
}
