package delivery

import (
	"context"
	"time"
)

type RepositoryMetadata struct {
	OrganizationID string    `json:"organization_id"`
	Slug           string    `json:"slug"`
	DefaultBranch  string    `json:"default_branch"`
	CreatedBy      string    `json:"created_by"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type RepositoryActivity struct {
	Slug           string `json:"-"`
	ChangesetCount int    `json:"changeset_count"`
	ActionCount    int    `json:"action_count"`
}

type RepositoryAction struct {
	ID        string    `json:"id"`
	Pipeline  string    `json:"pipeline"`
	Status    string    `json:"status"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
}

type RepositoryCatalog interface {
	RegisterRepository(context.Context, RepositoryMetadata) (RepositoryMetadata, error)
	ListRepositories(context.Context, string) ([]RepositoryMetadata, error)
}
