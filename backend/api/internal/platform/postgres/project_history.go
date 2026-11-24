package postgres

import (
	"context"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

func (s *Store) ProjectStatusHistory(ctx context.Context, orgID string, number int) ([]issues.ProjectStatusDay, error) {
	// Walk back from the current counts. Existing projects have a baseline from
	// the migration day, so the API never invents points before tracking began.
	rows, err := s.pool.Query(ctx, `WITH project AS (
		SELECT id, greatest((history_since AT TIME ZONE 'UTC')::date, now_utc - 29) AS first_day, now_utc
		FROM organization_projects CROSS JOIN (SELECT (now() AT TIME ZONE 'UTC')::date AS now_utc) AS clock
		WHERE organization_id = $1 AND number = $2
	), current_counts AS (
		SELECT count(*) FILTER (WHERE status = 'todo') AS todo,
			count(*) FILTER (WHERE status = 'in_progress') AS in_progress,
			count(*) FILTER (WHERE status = 'done') AS done
		FROM project_items JOIN project ON project.id = project_items.project_id
		WHERE organization_id = $1 AND NOT archived
	), daily_changes AS (
		SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day,
			count(*) FILTER (WHERE next_status = 'todo') - count(*) FILTER (WHERE previous_status = 'todo') AS todo,
			count(*) FILTER (WHERE next_status = 'in_progress') - count(*) FILTER (WHERE previous_status = 'in_progress') AS in_progress,
			count(*) FILTER (WHERE next_status = 'done') - count(*) FILTER (WHERE previous_status = 'done') AS done
		FROM project_status_history JOIN project ON project.id = project_status_history.project_id
		WHERE organization_id = $1 AND occurred_at >= (first_day::timestamp AT TIME ZONE 'UTC')
		GROUP BY day
	), timeline AS (
		SELECT first_day + offset_day AS day FROM project, generate_series(0, now_utc - first_day) AS offset_day
	)
	SELECT to_char(timeline.day, 'YYYY-MM-DD'),
		counts.todo - coalesce(sum(changes.todo) OVER later, 0)::bigint,
		counts.in_progress - coalesce(sum(changes.in_progress) OVER later, 0)::bigint,
		counts.done - coalesce(sum(changes.done) OVER later, 0)::bigint
	FROM timeline CROSS JOIN current_counts counts LEFT JOIN daily_changes changes ON changes.day = timeline.day
	WINDOW later AS (ORDER BY timeline.day DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
	ORDER BY timeline.day`, orgID, number)
	if err != nil {
		return nil, fmt.Errorf("query project status history: %w", err)
	}
	days, err := pgx.CollectRows(rows, pgx.RowToStructByPos[issues.ProjectStatusDay])
	if err != nil {
		return nil, fmt.Errorf("read project status history: %w", err)
	}
	if len(days) == 0 {
		return nil, issues.ErrProjectNotFound
	}
	return days, nil
}
