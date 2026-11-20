package postgres

import (
	"context"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

// Update updates an existing issue
func (r *IssueRepository) Update(ctx context.Context, organizationID string, issue *issues.Issue) (*issues.Issue, error) {
	_, err := r.store.pool.Exec(ctx, `
		UPDATE issues
		SET title = $1, body = $2, state = $3, updated_at = $4
		WHERE organization_id = $5 AND id = $6
	`, issue.Title, issue.Body, issue.State, issue.UpdatedAt, organizationID, issue.ID)

	if err != nil {
		return nil, fmt.Errorf("update issue: %w", err)
	}

	return issue, nil
}
