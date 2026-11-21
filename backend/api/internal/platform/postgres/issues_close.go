package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

// Close closes an issue with a specific reason
func (r *IssueRepository) Close(ctx context.Context, organizationID string, issueID issues.ID, reason issues.StateReason, closedBy string, closedAt time.Time) (*issues.Issue, error) {
	// Update issue state to closed
	_, err := r.store.pool.Exec(ctx, `
		UPDATE issues
		SET state = $1, state_reason = $2, closed_by = $3, closed_at = $4, updated_at = $5
		WHERE organization_id = $6 AND id = $7
	`, issues.StateClosed, reason, closedBy, closedAt, closedAt, organizationID, issueID)

	if err != nil {
		return nil, fmt.Errorf("close issue: %w", err)
	}

	// Retrieve updated issue
	var issue issues.Issue
	var stateStr, stateReasonStr, closedByStr string
	var closedAtTime time.Time

	err = r.store.pool.QueryRow(ctx, `
		SELECT id, repository, number, title, body, state, state_reason, created_by,
		       created_at, updated_at, closed_at, closed_by
		FROM issues
		WHERE organization_id = $1 AND id = $2
	`, organizationID, issueID).Scan(
		&issue.ID, &issue.Repository, &issue.Number, &issue.Title, &issue.Body,
		&stateStr, &stateReasonStr, &issue.CreatedBy,
		&issue.CreatedAt, &issue.UpdatedAt, &closedAtTime, &closedByStr,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("issue not found")
		}
		return nil, fmt.Errorf("query closed issue: %w", err)
	}

	issue.State = issues.State(stateStr)
	issue.StateReason = issues.StateReason(stateReasonStr)
	issue.ClosedAt = &closedAtTime
	issue.ClosedBy = closedByStr

	return &issue, nil
}
