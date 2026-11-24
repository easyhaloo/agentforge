package postgres

import (
	"context"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

const projectUpdateColumns = `id, status, body, author_name, created_at,
	coalesce(to_char(start_date, 'YYYY-MM-DD'), ''), coalesce(to_char(target_date, 'YYYY-MM-DD'), '')`

func (s *Store) ListProjectUpdates(ctx context.Context, org string, number int) ([]issues.ProjectUpdate, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin project update list: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, _, _, _, err := lockProject(ctx, tx, org, number, false)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT `+projectUpdateColumns+` FROM project_updates
		WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC, id DESC`, org, projectID)
	if err != nil {
		return nil, fmt.Errorf("query project updates: %w", err)
	}
	items, err := pgx.AppendRows(make([]issues.ProjectUpdate, 0), rows, pgx.RowToStructByPos[issues.ProjectUpdate])
	if err != nil {
		return nil, fmt.Errorf("read project updates: %w", err)
	}
	return items, nil
}

func (s *Store) CreateProjectUpdate(ctx context.Context, org string, number int, actorID string, input issues.ProjectUpdateInput) (issues.ProjectUpdate, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.ProjectUpdate{}, fmt.Errorf("begin project update creation: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, _, err := lockWritableProject(ctx, tx, org, number)
	if err != nil {
		return issues.ProjectUpdate{}, err
	}
	rows, err := tx.Query(ctx, `INSERT INTO project_updates (organization_id, project_id, status, body, author_name, start_date, target_date)
		SELECT $1, $2, $3, $4, display_name, NULLIF($6, '')::date, NULLIF($7, '')::date FROM users WHERE id = $5
		RETURNING `+projectUpdateColumns, org, projectID, input.Status, input.Body, actorID, input.StartDate, input.TargetDate)
	if err != nil {
		return issues.ProjectUpdate{}, fmt.Errorf("insert project update: %w", err)
	}
	update, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[issues.ProjectUpdate])
	if err != nil {
		return issues.ProjectUpdate{}, fmt.Errorf("read created project update: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return issues.ProjectUpdate{}, fmt.Errorf("commit project update: %w", err)
	}
	return update, nil
}
