package postgres

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ListProjectWorkflowRuns(ctx context.Context, organizationID string, number int) ([]issues.ProjectWorkflowRun, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin project workflow history read: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, _, _, _, err := lockProject(ctx, tx, organizationID, number, false)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT id, rule, item_count, occurred_at FROM project_workflow_runs
		WHERE organization_id = $1 AND project_id = $2 ORDER BY occurred_at DESC, id DESC LIMIT 50`, organizationID, projectID)
	if err != nil {
		return nil, fmt.Errorf("query project workflow history: %w", err)
	}
	runs, err := pgx.AppendRows(make([]issues.ProjectWorkflowRun, 0), rows, pgx.RowToStructByPos[issues.ProjectWorkflowRun])
	if err != nil {
		return nil, fmt.Errorf("read project workflow history: %w", err)
	}
	return runs, nil
}

func (s *Store) archiveDoneProjectItems(ctx context.Context, now time.Time) error {
	// Lock settings before selecting items so a concurrent close or rule edit
	// cannot race the archive. Skip active writes instead of blocking them.
	// ponytail: one bounded batch per tick; drain multiple batches if telemetry shows a backlog.
	_, err := s.pool.Exec(ctx, `WITH eligible AS MATERIALIZED (
		SELECT p.organization_id, p.id, make_interval(hours => (p.workflows->>'auto_archive_days')::integer * 24) AS delay
		FROM organization_projects p
		WHERE NOT p.closed AND (p.workflows->>'auto_archive_days')::integer > 0
		AND EXISTS (SELECT 1 FROM project_items i
			WHERE (i.organization_id, i.project_id) = (p.organization_id, p.id)
			AND i.done_since <= $1::timestamptz - make_interval(hours => (p.workflows->>'auto_archive_days')::integer * 24))
		FOR SHARE OF p SKIP LOCKED
	), due AS (
		SELECT i.organization_id, i.project_id, i.id FROM project_items i
		JOIN eligible p ON (i.organization_id, i.project_id) = (p.organization_id, p.id)
		WHERE i.done_since <= $1::timestamptz - p.delay
		AND (i.issue_id IS NULL OR EXISTS (SELECT 1 FROM enabled_repository_issues source
			WHERE (source.organization_id, source.id) = (i.organization_id, i.issue_id)))
		ORDER BY i.done_since, i.organization_id, i.project_id, i.id LIMIT 500
		FOR UPDATE OF i SKIP LOCKED
	), archived AS (
		UPDATE project_items i SET archived = true, version = i.version + 1 FROM due
		WHERE (i.organization_id, i.project_id, i.id) = (due.organization_id, due.project_id, due.id)
		RETURNING i.organization_id, i.project_id
	)
	INSERT INTO project_workflow_runs (organization_id, project_id, rule, item_count)
	SELECT organization_id, project_id, 'auto_archive', count(*) FROM archived GROUP BY organization_id, project_id`, now)
	if err != nil {
		return fmt.Errorf("archive completed project items: %w", err)
	}
	return nil
}

func (s *Store) RunProjectArchiveWorker(ctx context.Context, logger *slog.Logger) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for ctx.Err() == nil {
		if err := s.archiveDoneProjectItems(ctx, time.Now()); err != nil && ctx.Err() == nil {
			logger.Error("project auto-archive failed", "error", err)
		}
		select {
		case <-ctx.Done():
		case <-ticker.C:
		}
	}
}
