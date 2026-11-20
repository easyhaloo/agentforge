package postgres

import (
	"context"
	"errors"
	"fmt"

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
	_, err = r.store.pool.Exec(ctx, `
		INSERT INTO issues (
			organization_id, id, repository, number, title, body,
			state, created_by, created_at, updated_at, version
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
	`, organizationID, issue.ID, issue.Repository, issue.Number, issue.Title, issue.Body,
		issue.State, issue.CreatedBy, issue.CreatedAt, issue.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("insert issue: %w", err)
	}

	return issue, nil
}

// Get retrieves an issue by repository and number
func (r *IssueRepository) Get(ctx context.Context, organizationID, repository string, number int) (*issues.Issue, error) {
	var issue issues.Issue
	var stateStr string

	err := r.store.pool.QueryRow(ctx, `
		SELECT id, repository, number, title, body, state, created_by, created_at, updated_at
		FROM issues
		WHERE organization_id = $1 AND repository = $2 AND number = $3
	`, organizationID, repository, number).Scan(
		&issue.ID, &issue.Repository, &issue.Number, &issue.Title, &issue.Body,
		&stateStr, &issue.CreatedBy, &issue.CreatedAt, &issue.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("issue not found")
		}
		return nil, fmt.Errorf("query issue: %w", err)
	}

	issue.State = issues.State(stateStr)
	return &issue, nil
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
