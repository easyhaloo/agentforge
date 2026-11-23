package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

type IssueRepository struct {
	store *Store
}

func NewIssueRepository(store *Store) *IssueRepository {
	return &IssueRepository{store: store}
}

// Create persists a new issue and allocates a sequential number
func (r *IssueRepository) Create(ctx context.Context, organizationID string, issue *issues.Issue) (*issues.Issue, error) {
	// Allocate sequential number
	number, err := r.allocateNumber(ctx, organizationID, issue.Repository)
	if err != nil {
		return nil, fmt.Errorf("allocate number: %w", err)
	}
	issue.Number = number

	// Insert issue
	row := r.store.pool.QueryRow(ctx, `
		INSERT INTO issues (
			organization_id, id, repository, number, title, body,
			state, created_by, created_at, updated_at, version
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
		RETURNING `+issueColumns, organizationID, issue.ID, issue.Repository, issue.Number, issue.Title, issue.Body,
		issue.State, issue.CreatedBy, issue.CreatedAt, issue.UpdatedAt)

	return scanIssue(row)
}

// AddAssignee assigns a user to an issue (idempotent)
func (r *IssueRepository) AddAssignee(ctx context.Context, organizationID string, issueID string, userID string) error {
	_, err := r.store.pool.Exec(ctx, `
		INSERT INTO issue_assignees (organization_id, issue_id, user_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (organization_id, issue_id, user_id) DO NOTHING
	`, organizationID, issueID, userID)

	if err != nil {
		return fmt.Errorf("add assignee: %w", err)
	}

	return nil
}

// RemoveAssignee unassigns a user from an issue
func (r *IssueRepository) RemoveAssignee(ctx context.Context, organizationID string, issueID string, userID string) error {
	_, err := r.store.pool.Exec(ctx, `
		DELETE FROM issue_assignees
		WHERE organization_id = $1 AND issue_id = $2 AND user_id = $3
	`, organizationID, issueID, userID)

	if err != nil {
		return fmt.Errorf("remove assignee: %w", err)
	}

	return nil
}

// GetAssignees retrieves all assignees for an issue
func (r *IssueRepository) GetAssignees(ctx context.Context, organizationID string, issueID string) ([]string, error) {
	rows, err := r.store.pool.Query(ctx, `
		SELECT user_id
		FROM issue_assignees
		WHERE organization_id = $1 AND issue_id = $2
		ORDER BY user_id ASC
	`, organizationID, issueID)
	if err != nil {
		return nil, fmt.Errorf("query assignees: %w", err)
	}
	defer rows.Close()

	var assignees []string
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, fmt.Errorf("scan assignee: %w", err)
		}
		assignees = append(assignees, userID)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate assignees: %w", err)
	}

	return assignees, nil
}

// issueColumns keeps the projection consistent across list, detail and mutation responses.
const issueColumns = `id, repository, number, title, body, state, COALESCE(state_reason, ''),
	COALESCE(milestone_id, ''), comments_count, locked, COALESCE(lock_reason, ''), locked_at,
	COALESCE(locked_by, ''), created_by, created_at, updated_at, closed_at, COALESCE(closed_by, ''),
	COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name,
		'description', l.description, 'color', l.color, 'created_at', l.created_at,
		'updated_at', l.updated_at) ORDER BY l.name)
		FROM issue_labels il JOIN labels l ON l.organization_id = il.organization_id AND l.id = il.label_id
		WHERE il.organization_id = issues.organization_id AND il.issue_id = issues.id
		  AND l.repository = issues.repository), '[]'::jsonb),
	COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', a.user_id) ORDER BY a.user_id)
		FROM issue_assignees a WHERE a.organization_id = issues.organization_id AND a.issue_id = issues.id), '[]'::jsonb)`

func scanIssue(row pgx.Row) (*issues.Issue, error) {
	var issue issues.Issue
	if err := row.Scan(
		&issue.ID, &issue.Repository, &issue.Number, &issue.Title, &issue.Body, &issue.State,
		&issue.StateReason, &issue.MilestoneID, &issue.CommentsCount, &issue.Locked, &issue.LockReason,
		&issue.LockedAt, &issue.LockedBy, &issue.CreatedBy, &issue.CreatedAt, &issue.UpdatedAt,
		&issue.ClosedAt, &issue.ClosedBy, &issue.Labels, &issue.Assignees,
	); err != nil {
		return nil, fmt.Errorf("scan issue: %w", err)
	}
	return &issue, nil
}

// Get retrieves an issue by repository and number.
func (r *IssueRepository) Get(ctx context.Context, organizationID, repository string, number int) (*issues.Issue, error) {
	return scanIssue(r.store.pool.QueryRow(ctx, `SELECT `+issueColumns+`
		FROM issues WHERE organization_id = $1 AND repository = $2 AND number = $3`, organizationID, repository, number))
}

// allocateNumber atomically allocates the next sequential number for a repository
func (r *IssueRepository) allocateNumber(ctx context.Context, organizationID, repository string) (int, error) {
	// Ensure counter exists
	_, err := r.store.pool.Exec(ctx, `
		INSERT INTO resource_number_counters (organization_id, repository, last_number)
		VALUES ($1, $2, 0)
		ON CONFLICT (organization_id, repository) DO NOTHING
	`, organizationID, repository)
	if err != nil {
		return 0, fmt.Errorf("initialize counter: %w", err)
	}

	// Atomically increment and return
	var number int
	err = r.store.pool.QueryRow(ctx, `
		UPDATE resource_number_counters
		SET last_number = last_number + 1
		WHERE organization_id = $1 AND repository = $2
		RETURNING last_number
	`, organizationID, repository).Scan(&number)
	if err != nil {
		return 0, fmt.Errorf("allocate number: %w", err)
	}

	return number, nil
}

// Lock locks an issue to prevent new comments.
func (r *IssueRepository) Lock(ctx context.Context, organizationID string, issueID issues.ID, reason issues.LockReason, lockedBy string, lockedAt time.Time) (*issues.Issue, error) {
	return scanIssue(r.store.pool.QueryRow(ctx, `
		UPDATE issues
		SET locked = true, lock_reason = $1, locked_at = $2, locked_by = $3, updated_at = $2
		WHERE organization_id = $4 AND id = $5
		RETURNING `+issueColumns, reason, lockedAt, lockedBy, organizationID, issueID))
}

// Unlock unlocks an issue to allow new comments.
func (r *IssueRepository) Unlock(ctx context.Context, organizationID string, issueID issues.ID) (*issues.Issue, error) {
	return scanIssue(r.store.pool.QueryRow(ctx, `
		UPDATE issues
		SET locked = false, lock_reason = NULL, locked_at = NULL, locked_by = NULL, updated_at = now()
		WHERE organization_id = $1 AND id = $2
		RETURNING `+issueColumns, organizationID, issueID))
}
