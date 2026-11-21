package postgres

import (
	"context"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

// Update updates an existing issue's title and body.
func (r *IssueRepository) Update(ctx context.Context, organizationID string, issue *issues.Issue) (*issues.Issue, error) {
	return scanIssue(r.store.pool.QueryRow(ctx, `
		UPDATE issues
		SET title = $1, body = $2, updated_at = $3
		WHERE organization_id = $4 AND id = $5
		RETURNING `+issueColumns, issue.Title, issue.Body, issue.UpdatedAt, organizationID, issue.ID))
}
