package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
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

// The merge caller holds the repository policy lock through this transaction.
func closeMergedPullIssues(ctx context.Context, tx pgx.Tx, org string, c *delivery.Changeset, target, actor string) error {
	if c.PullRequest == nil {
		return nil
	}
	_, err := tx.Exec(ctx, `WITH closed AS (
		UPDATE issues i SET state = 'closed', state_reason = 'completed', closed_by = $5,
			closed_at = statement_timestamp(), updated_at = statement_timestamp(), version = i.version + 1
		FROM issue_changeset_links l, delivery_repositories r
		WHERE (i.organization_id, i.id) = (l.organization_id, l.issue_id) AND l.changeset_id = $3
			AND (i.organization_id, i.repository) = (r.organization_id, r.slug)
			AND r.organization_id = $1 AND r.slug = $2 AND r.default_branch = $4
			AND NOT r.issues_disabled AND NOT r.auto_close_issues_disabled AND i.state = 'open'
		RETURNING i.organization_id, i.id, i.updated_at
	)
	INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, metadata, created_at)
	SELECT organization_id, gen_random_uuid()::text, id, 'closed', $5,
		jsonb_build_object('reason', 'completed', 'changeset_id', $3::text), updated_at FROM closed`,
		org, c.Repository, string(c.ID), target, actor)
	if err != nil {
		return fmt.Errorf("close issues linked to merged pull request: %w", err)
	}
	return nil
}
