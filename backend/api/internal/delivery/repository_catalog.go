package delivery

import (
	"context"
	"time"
)

type RepositoryMetadata struct {
	OrganizationID string `json:"organization_id"`
	Slug string `json:"slug"`
	DefaultBranch string `json:"default_branch"`
	CreatedBy string `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type RepositoryCatalog interface {
	RegisterRepository(context.Context, RepositoryMetadata) (RepositoryMetadata,error)
	ListRepositories(context.Context,string) ([]RepositoryMetadata,error)
}
