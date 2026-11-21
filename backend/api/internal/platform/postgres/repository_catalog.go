package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (s *Store) RegisterRepository(ctx context.Context, input delivery.RepositoryMetadata) (delivery.RepositoryMetadata, error) {
	input.OrganizationID = strings.TrimSpace(input.OrganizationID)
	input.Slug = strings.TrimSpace(input.Slug)
	input.DefaultBranch = strings.TrimSpace(input.DefaultBranch)
	input.CreatedBy = strings.TrimSpace(input.CreatedBy)
	if input.OrganizationID == "" || input.Slug == "" || input.DefaultBranch == "" || input.CreatedBy == "" {
		return delivery.RepositoryMetadata{}, delivery.ErrInvalidInput
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO delivery_repositories (organization_id,slug,default_branch,created_by,description)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING created_at,updated_at
	`, input.OrganizationID, input.Slug, input.DefaultBranch, input.CreatedBy, input.Description).Scan(&input.CreatedAt, &input.UpdatedAt)
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			return delivery.RepositoryMetadata{}, delivery.ErrVersionConflict
		}
		return delivery.RepositoryMetadata{}, fmt.Errorf("register repository: %w", err)
	}
	return input, nil
}

func (s *Store) ListRepositories(ctx context.Context, organizationID string) ([]delivery.RepositoryMetadata, error) {
	if strings.TrimSpace(organizationID) == "" {
		return nil, delivery.ErrInvalidInput
	}
	rows, err := s.pool.Query(ctx, `
		SELECT organization_id,slug,default_branch,created_by,created_at,updated_at,description
		FROM delivery_repositories WHERE organization_id=$1 ORDER BY slug ASC
	`, organizationID)
	if err != nil {
		return nil, fmt.Errorf("list repositories: %w", err)
	}
	defer rows.Close()
	items := make([]delivery.RepositoryMetadata, 0)
	for rows.Next() {
		var item delivery.RepositoryMetadata
		if err := rows.Scan(&item.OrganizationID, &item.Slug, &item.DefaultBranch, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt, &item.Description); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

var _ delivery.RepositoryCatalog = (*Store)(nil)

func (s *Store) SetRepositoryDefaultBranch(ctx context.Context, org, slug, branch, previous string) error {
	result, err := s.pool.Exec(ctx, `UPDATE delivery_repositories SET default_branch=$3, updated_at=now()
		WHERE organization_id=$1 AND slug=$2 AND default_branch=$4`, org, slug, branch, previous)
	if err == nil && result.RowsAffected() == 0 {
		return delivery.ErrVersionConflict
	}
	return err
}

// Run attribution comes from the explicit repository in an integration or trigger snapshot.
const runRepository = `COALESCE(integration->>'repository', trigger_source->>'repository')`

func (s *Store) RepositoryActivities(ctx context.Context, org string) ([]delivery.RepositoryActivity, error) {
	rows, err := s.pool.Query(ctx, `WITH changes AS (
		SELECT repository, count(*) AS total FROM delivery_changesets WHERE organization_id=$1 GROUP BY repository
	), actions AS (
		SELECT `+runRepository+` AS repository, count(*) AS total FROM pipeline_runs WHERE organization_id=$1 GROUP BY 1
	)
	SELECT r.slug, coalesce(changes.total, 0), coalesce(actions.total, 0) FROM delivery_repositories r
	LEFT JOIN changes ON changes.repository=r.slug LEFT JOIN actions ON actions.repository=r.slug
	WHERE r.organization_id=$1`, org)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[delivery.RepositoryActivity])
}

func (s *Store) ListRepositoryActions(ctx context.Context, org, slug string, limit, offset int) ([]delivery.RepositoryAction, error) {
	rows, err := s.pool.Query(ctx, `SELECT r.id, p.name, r.status, r.version, r.created_at FROM pipeline_runs r
	JOIN pipelines p ON p.organization_id=r.organization_id AND p.id=r.pipeline_id
	WHERE r.organization_id=$1 AND `+runRepository+`=$2 ORDER BY r.created_at DESC, r.id DESC LIMIT $3 OFFSET $4`, org, slug, limit, offset)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[delivery.RepositoryAction])
}
