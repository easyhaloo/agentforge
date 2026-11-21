package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

// List retrieves issues with filtering, pagination, and sorting
func (r *IssueRepository) List(ctx context.Context, organizationID string, filter issues.ListFilter, limit, offset int) ([]*issues.Issue, int, error) {
	// Build WHERE clause dynamically
	var conditions []string
	var args []interface{}
	argIdx := 1

	// Always filter by organization
	conditions = append(conditions, fmt.Sprintf("organization_id = $%d", argIdx))
	args = append(args, organizationID)
	argIdx++

	// Filter by repository if specified
	if filter.Repository != "" {
		conditions = append(conditions, fmt.Sprintf("repository = $%d", argIdx))
		args = append(args, filter.Repository)
		argIdx++
	}

	// Filter by state if specified
	if filter.State != "" {
		conditions = append(conditions, fmt.Sprintf("state = $%d", argIdx))
		args = append(args, filter.State)
		argIdx++
	}

	// Filter by creator if specified
	if filter.CreatedBy != "" {
		conditions = append(conditions, fmt.Sprintf("created_by = $%d", argIdx))
		args = append(args, filter.CreatedBy)
		argIdx++
	}

	// Filter by updated_at >= since
	if filter.Since != nil {
		conditions = append(conditions, fmt.Sprintf("updated_at >= $%d", argIdx))
		args = append(args, *filter.Since)
		argIdx++
	}

	// Full-text search in title and body
	if filter.Query != "" {
		conditions = append(conditions, fmt.Sprintf("(title ILIKE $%d OR body ILIKE $%d)", argIdx, argIdx+1))
		pattern := "%" + filter.Query + "%"
		args = append(args, pattern, pattern)
		argIdx += 2
	}

	whereClause := strings.Join(conditions, " AND ")

	// Count total matching issues
	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM issues WHERE %s", whereClause)
	if err := r.store.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count issues: %w", err)
	}

	// Query issues with pagination
	query := fmt.Sprintf(`
		SELECT id, repository, number, title, body, state, locked, created_by, created_at, updated_at
		FROM issues
		WHERE %s
		ORDER BY updated_at DESC, number DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, argIdx, argIdx+1)

	args = append(args, limit, offset)

	rows, err := r.store.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query issues: %w", err)
	}
	defer rows.Close()

	var result []*issues.Issue
	for rows.Next() {
		var issue issues.Issue
		var stateStr string

		if err := rows.Scan(
			&issue.ID, &issue.Repository, &issue.Number, &issue.Title, &issue.Body,
			&stateStr, &issue.Locked, &issue.CreatedBy, &issue.CreatedAt, &issue.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan issue: %w", err)
		}

		issue.State = issues.State(stateStr)
		result = append(result, &issue)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("rows error: %w", err)
	}

	return result, total, nil
}
