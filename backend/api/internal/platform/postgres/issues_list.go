package postgres

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

// List retrieves a page of issues and counts for each state before pagination.
func (r *IssueRepository) List(ctx context.Context, organizationID string, filter issues.ListFilter, limit, offset int) ([]*issues.Issue, issues.ListCounts, error) {
	var counts issues.ListCounts
	conditions := []string{"organization_id = $1"}
	args := []any{organizationID}
	bind := func(value any) string {
		args = append(args, value)
		return "$" + strconv.Itoa(len(args))
	}

	if filter.Repository != "" {
		conditions = append(conditions, "repository = "+bind(filter.Repository))
	}
	if filter.CreatedBy != "" {
		conditions = append(conditions, "created_by = "+bind(filter.CreatedBy))
	}
	if filter.Since != nil {
		conditions = append(conditions, "updated_at >= "+bind(*filter.Since))
	}
	if filter.Milestone != "" {
		conditions = append(conditions, "milestone_id = "+bind(filter.Milestone))
	}
	if filter.Assignee != "" {
		conditions = append(conditions, `EXISTS (SELECT 1 FROM issue_assignees a
			WHERE a.organization_id = issues.organization_id AND a.issue_id = issues.id AND a.user_id = `+bind(filter.Assignee)+`)`)
	}
	if filter.Label != "" {
		conditions = append(conditions, `EXISTS (SELECT 1 FROM issue_labels il
			JOIN labels l ON l.organization_id = il.organization_id AND l.id = il.label_id
			WHERE il.organization_id = issues.organization_id AND il.issue_id = issues.id
			  AND l.repository = issues.repository AND l.name = `+bind(filter.Label)+`)`)
	}
	if filter.Query != "" {
		number, err := strconv.ParseInt(strings.TrimPrefix(filter.Query, "#"), 10, 32)
		if strings.HasPrefix(filter.Query, "#") && err == nil && number > 0 {
			conditions = append(conditions, "number = "+bind(number))
		} else {
			pattern := bind("%" + filter.Query + "%")
			conditions = append(conditions, "(title ILIKE "+pattern+" OR body ILIKE "+pattern+")")
		}
	}

	where := strings.Join(conditions, " AND ")
	if err := r.store.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE state = 'open'), COUNT(*) FILTER (WHERE state = 'closed')
		FROM issues WHERE `+where, args...).Scan(&counts.OpenTotal, &counts.ClosedTotal); err != nil {
		return nil, counts, fmt.Errorf("count issues: %w", err)
	}
	counts.Total = counts.OpenTotal + counts.ClosedTotal
	if filter.State != "" {
		where += " AND state = " + bind(filter.State)
		switch filter.State {
		case issues.StateOpen:
			counts.Total = counts.OpenTotal
		case issues.StateClosed:
			counts.Total = counts.ClosedTotal
		}
	}

	sort := "updated_at"
	switch filter.Sort {
	case "created":
		sort = "created_at"
	case "comments":
		sort = "comments_count"
	}
	direction := "DESC"
	if filter.Direction == "asc" {
		direction = "ASC"
	}
	query := `SELECT ` + issueColumns + ` FROM issues WHERE ` + where + `
		ORDER BY ` + sort + ` ` + direction + `, number ` + direction + `, id
		LIMIT ` + bind(limit) + ` OFFSET ` + bind(offset)
	rows, err := r.store.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, counts, fmt.Errorf("query issues: %w", err)
	}
	defer rows.Close()

	result := make([]*issues.Issue, 0)
	for rows.Next() {
		issue, err := scanIssue(rows)
		if err != nil {
			return nil, counts, err
		}
		result = append(result, issue)
	}
	if err := rows.Err(); err != nil {
		return nil, counts, fmt.Errorf("iterate issues: %w", err)
	}
	return result, counts, nil
}

// FilterOptions returns the distinct values used by issues across a repository.
func (r *IssueRepository) FilterOptions(ctx context.Context, organizationID, repository string) (issues.FilterOptions, error) {
	var options issues.FilterOptions
	err := r.store.pool.QueryRow(ctx, `
		WITH scoped AS (
			SELECT organization_id, id, created_by, milestone_id FROM issues WHERE organization_id = $1 AND repository = $2
		)
		SELECT ARRAY(SELECT DISTINCT created_by FROM scoped ORDER BY created_by),
		       ARRAY(SELECT DISTINCT l.name FROM scoped s
		             JOIN issue_labels il ON il.organization_id = s.organization_id AND il.issue_id = s.id
		             JOIN labels l ON l.organization_id = il.organization_id AND l.id = il.label_id
		             WHERE l.repository = $2 ORDER BY l.name),
		       ARRAY(SELECT DISTINCT a.user_id FROM scoped s
		             JOIN issue_assignees a ON a.organization_id = s.organization_id AND a.issue_id = s.id
		             ORDER BY a.user_id),
		       ARRAY(SELECT DISTINCT milestone_id FROM scoped WHERE milestone_id IS NOT NULL ORDER BY milestone_id)
	`, organizationID, repository).Scan(&options.Authors, &options.Labels, &options.Assignees, &options.Milestones)
	if err != nil {
		return options, fmt.Errorf("list issue filter options: %w", err)
	}
	return options, nil
}
