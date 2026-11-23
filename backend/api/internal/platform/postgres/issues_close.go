package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

// Close closes an issue with a specific reason.
func (r *IssueRepository) Close(ctx context.Context, organizationID string, issueID issues.ID, reason issues.StateReason, closedBy string, closedAt time.Time) (*issues.Issue, error) {
	issue, err := scanIssue(r.store.pool.QueryRow(ctx, `
		WITH mutated AS (
			UPDATE issues SET state = 'closed', state_reason = $1, closed_by = $2, closed_at = $3, updated_at = $3
			WHERE organization_id = $4 AND id = $5 AND state = 'open' RETURNING *
		), event AS (
			INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, metadata, created_at)
			SELECT organization_id, gen_random_uuid()::text, id, 'closed', closed_by, jsonb_build_object('reason', state_reason), updated_at FROM mutated
		)
		SELECT `+issueColumns+` FROM mutated AS issues`, reason, closedBy, closedAt, organizationID, issueID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, issues.ErrStateConflict
	}
	return issue, err
}

// Reopen restores the open state and clears closure metadata atomically.
func (r *IssueRepository) Reopen(ctx context.Context, organizationID string, issueID issues.ID, actorID string, updatedAt time.Time) (*issues.Issue, error) {
	issue, err := scanIssue(r.store.pool.QueryRow(ctx, `
		WITH mutated AS (
			UPDATE issues SET state = 'open', state_reason = NULL, closed_by = NULL, closed_at = NULL, updated_at = $1
			WHERE organization_id = $2 AND id = $3 AND state = 'closed' RETURNING *
		), event AS (
			INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, created_at)
			SELECT organization_id, gen_random_uuid()::text, id, 'reopened', $4, updated_at FROM mutated
		)
		SELECT `+issueColumns+` FROM mutated AS issues`, updatedAt, organizationID, issueID, actorID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, issues.ErrStateConflict
	}
	return issue, err
}
