package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/milestones"
	"github.com/jackc/pgx/v5"
)

type MilestoneRepository struct {
	store *Store
}

func NewMilestoneRepository(store *Store) *MilestoneRepository {
	return &MilestoneRepository{store: store}
}

// Create persists a new milestone
func (r *MilestoneRepository) Create(ctx context.Context, organizationID string, milestone *milestones.Milestone) (*milestones.Milestone, error) {
	now := time.Now()
	if milestone.CreatedAt.IsZero() {
		milestone.CreatedAt = now
	}
	if milestone.UpdatedAt.IsZero() {
		milestone.UpdatedAt = now
	}

	_, err := r.store.pool.Exec(ctx, `
		INSERT INTO milestones (
			organization_id, id, repository, title, description, due_on,
			state, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, organizationID, milestone.ID, milestone.Repository, milestone.Title, milestone.Description,
		milestone.DueOn, milestone.State, milestone.CreatedAt, milestone.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("insert milestone: %w", err)
	}

	return milestone, nil
}

// Get retrieves a milestone by ID
func (r *MilestoneRepository) Get(ctx context.Context, organizationID string, milestoneID milestones.ID) (*milestones.Milestone, error) {
	var milestone milestones.Milestone
	var description sql.NullString
	var dueOn sql.NullTime
	var closedAt sql.NullTime

	err := r.store.pool.QueryRow(ctx, `
		SELECT id, repository, title, description, due_on, state,
		       created_at, updated_at, closed_at
		FROM milestones
		WHERE organization_id = $1 AND id = $2
	`, organizationID, milestoneID).Scan(
		&milestone.ID, &milestone.Repository, &milestone.Title, &description, &dueOn,
		&milestone.State, &milestone.CreatedAt, &milestone.UpdatedAt, &closedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("milestone not found")
		}
		return nil, fmt.Errorf("query milestone: %w", err)
	}

	if description.Valid {
		milestone.Description = description.String
	}
	if dueOn.Valid {
		t := dueOn.Time
		milestone.DueOn = &t
	}
	if closedAt.Valid {
		t := closedAt.Time
		milestone.ClosedAt = &t
	}

	return &milestone, nil
}

// List retrieves milestones for a repository, optionally filtered by state
func (r *MilestoneRepository) List(ctx context.Context, organizationID, repository string, state milestones.State) ([]*milestones.Milestone, error) {
	var query string
	var args []interface{}

	if state == "" {
		// List all milestones
		query = `
			SELECT id, repository, title, description, due_on, state,
			       created_at, updated_at, closed_at
			FROM milestones
			WHERE organization_id = $1 AND repository = $2
			ORDER BY created_at DESC
		`
		args = []interface{}{organizationID, repository}
	} else {
		// Filter by state
		query = `
			SELECT id, repository, title, description, due_on, state,
			       created_at, updated_at, closed_at
			FROM milestones
			WHERE organization_id = $1 AND repository = $2 AND state = $3
			ORDER BY created_at DESC
		`
		args = []interface{}{organizationID, repository, state}
	}

	rows, err := r.store.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query milestones: %w", err)
	}
	defer rows.Close()

	var result []*milestones.Milestone
	for rows.Next() {
		var m milestones.Milestone
		var description sql.NullString
		var dueOn sql.NullTime
		var closedAt sql.NullTime

		err := rows.Scan(
			&m.ID, &m.Repository, &m.Title, &description, &dueOn,
			&m.State, &m.CreatedAt, &m.UpdatedAt, &closedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan milestone: %w", err)
		}

		if description.Valid {
			m.Description = description.String
		}
		if dueOn.Valid {
			t := dueOn.Time
			m.DueOn = &t
		}
		if closedAt.Valid {
			t := closedAt.Time
			m.ClosedAt = &t
		}

		result = append(result, &m)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}

	return result, nil
}

// Update updates an existing milestone
func (r *MilestoneRepository) Update(ctx context.Context, organizationID string, milestone *milestones.Milestone) (*milestones.Milestone, error) {
	milestone.UpdatedAt = time.Now()

	_, err := r.store.pool.Exec(ctx, `
		UPDATE milestones
		SET title = $1, description = $2, due_on = $3, updated_at = $4
		WHERE organization_id = $5 AND id = $6
	`, milestone.Title, milestone.Description, milestone.DueOn, milestone.UpdatedAt,
		organizationID, milestone.ID)

	if err != nil {
		return nil, fmt.Errorf("update milestone: %w", err)
	}

	return milestone, nil
}

// Delete removes a milestone
func (r *MilestoneRepository) Delete(ctx context.Context, organizationID string, milestoneID milestones.ID) error {
	_, err := r.store.pool.Exec(ctx, `
		DELETE FROM milestones
		WHERE organization_id = $1 AND id = $2
	`, organizationID, milestoneID)

	if err != nil {
		return fmt.Errorf("delete milestone: %w", err)
	}

	return nil
}

// Close closes a milestone
func (r *MilestoneRepository) Close(ctx context.Context, organizationID string, milestoneID milestones.ID, closedAt time.Time) (*milestones.Milestone, error) {
	_, err := r.store.pool.Exec(ctx, `
		UPDATE milestones
		SET state = $1, closed_at = $2, updated_at = $3
		WHERE organization_id = $4 AND id = $5
	`, milestones.StateClosed, closedAt, time.Now(), organizationID, milestoneID)

	if err != nil {
		return nil, fmt.Errorf("close milestone: %w", err)
	}

	return r.Get(ctx, organizationID, milestoneID)
}

// SetMilestone associates an issue with a milestone
func (r *MilestoneRepository) SetMilestone(ctx context.Context, organizationID, issueID, milestoneID string) error {
	_, err := r.store.pool.Exec(ctx, `
		UPDATE issues
		SET milestone_id = $1, updated_at = $2
		WHERE organization_id = $3 AND id = $4
	`, milestoneID, time.Now(), organizationID, issueID)

	if err != nil {
		return fmt.Errorf("set milestone: %w", err)
	}

	return nil
}

// ClearMilestone removes the milestone association from an issue
func (r *MilestoneRepository) ClearMilestone(ctx context.Context, organizationID, issueID string) error {
	_, err := r.store.pool.Exec(ctx, `
		UPDATE issues
		SET milestone_id = NULL, updated_at = $1
		WHERE organization_id = $2 AND id = $3
	`, time.Now(), organizationID, issueID)

	if err != nil {
		return fmt.Errorf("clear milestone: %w", err)
	}

	return nil
}

// GetProgress retrieves milestone completion statistics
func (r *MilestoneRepository) GetProgress(ctx context.Context, organizationID string, milestoneID milestones.ID) (*milestones.Progress, error) {
	var openCount, closedCount int

	err := r.store.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE state = 'open') as open_issues,
			COUNT(*) FILTER (WHERE state = 'closed') as closed_issues
		FROM issues
		WHERE organization_id = $1 AND milestone_id = $2
	`, organizationID, milestoneID).Scan(&openCount, &closedCount)

	if err != nil {
		return nil, fmt.Errorf("query progress: %w", err)
	}

	totalCount := openCount + closedCount
	var percentage float64
	if totalCount > 0 {
		percentage = float64(closedCount) / float64(totalCount) * 100
	}

	return &milestones.Progress{
		OpenIssues:   openCount,
		ClosedIssues: closedCount,
		TotalIssues:  totalCount,
		Percentage:   percentage,
	}, nil
}
