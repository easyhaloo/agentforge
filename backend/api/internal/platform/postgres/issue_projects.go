package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ListIssueProjects(ctx context.Context, organizationID, repository, actorID string) ([]issues.Project, error) {
	rows, err := s.pool.Query(ctx, `SELECT p.id, p.name, coalesce(p.repository, ''), EXISTS (
		SELECT 1 FROM issue_projects ip JOIN issues i ON i.organization_id = ip.organization_id AND i.id = ip.issue_id
		WHERE ip.organization_id = p.organization_id AND ip.project_id = p.id
		AND i.created_by = $3 AND i.created_at > now() - interval '30 days'
	), p.number
	FROM organization_projects p
	WHERE p.organization_id = $1 AND ($2 = '' OR p.repository IS NULL OR p.repository = $2)
	ORDER BY lower(p.name), p.id`, organizationID, repository, actorID)
	if err != nil {
		return nil, fmt.Errorf("query issue projects: %w", err)
	}
	items, err := pgx.AppendRows(make([]issues.Project, 0), rows, pgx.RowToStructByPos[issues.Project])
	if err != nil {
		return nil, fmt.Errorf("read issue projects: %w", err)
	}
	return items, nil
}

func (s *Store) CreateIssueProject(ctx context.Context, organizationID string, project issues.Project) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin issue project creation: %w", err)
	}
	defer tx.Rollback(ctx)
	// Serialize number allocation within an organization.
	if _, err := tx.Exec(ctx, `SELECT id FROM organizations WHERE id = $1 FOR UPDATE`, organizationID); err != nil {
		return 0, fmt.Errorf("lock issue project scope: %w", err)
	}
	var number int
	err = tx.QueryRow(ctx, `INSERT INTO organization_projects(organization_id, id, name, repository, number)
		SELECT $1, $2, $3, nullif($4, ''), coalesce(max(number), 0) + 1
		FROM organization_projects WHERE organization_id = $1
		ON CONFLICT DO NOTHING RETURNING number`, organizationID, project.ID, project.Name, project.Repository).Scan(&number)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, issues.ErrProjectNameInUse
	}
	if err != nil {
		return 0, fmt.Errorf("create issue project: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit issue project creation: %w", err)
	}
	return number, nil
}
