package postgres

import (
	"context"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/labels"
	"github.com/jackc/pgx/v5"
)

type LabelRepository struct {
	store *Store
}

func NewLabelRepository(store *Store) *LabelRepository {
	return &LabelRepository{store: store}
}

// Create persists a new label in a repository
func (r *LabelRepository) Create(ctx context.Context, organizationID string, label *labels.Label) (*labels.Label, error) {
	_, err := r.store.pool.Exec(ctx, `
		INSERT INTO labels (
			organization_id, id, repository, name, description, color, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, organizationID, label.ID, label.Repository, label.Name, label.Description,
		label.Color, label.CreatedAt, label.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("insert label: %w", err)
	}

	return label, nil
}

// Get retrieves a label by ID
func (r *LabelRepository) Get(ctx context.Context, organizationID string, labelID labels.ID) (*labels.Label, error) {
	var label labels.Label

	err := r.store.pool.QueryRow(ctx, `
		SELECT id, repository, name, description, color, created_at, updated_at
		FROM labels
		WHERE organization_id = $1 AND id = $2
	`, organizationID, labelID).Scan(
		&label.ID,
		&label.Repository,
		&label.Name,
		&label.Description,
		&label.Color,
		&label.CreatedAt,
		&label.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("label not found: %s", labelID)
		}
		return nil, fmt.Errorf("query label: %w", err)
	}

	return &label, nil
}

// List retrieves labels with filtering
func (r *LabelRepository) List(ctx context.Context, organizationID string, filter labels.ListFilter) ([]*labels.Label, error) {
	query := `
		SELECT id, repository, name, description, color, created_at, updated_at
		FROM labels
		WHERE organization_id = $1 AND repository = $2
		ORDER BY name ASC
	`

	rows, err := r.store.pool.Query(ctx, query, organizationID, filter.Repository)
	if err != nil {
		return nil, fmt.Errorf("query labels: %w", err)
	}
	defer rows.Close()

	var result []*labels.Label
	for rows.Next() {
		var label labels.Label
		err := rows.Scan(
			&label.ID,
			&label.Repository,
			&label.Name,
			&label.Description,
			&label.Color,
			&label.CreatedAt,
			&label.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan label: %w", err)
		}
		result = append(result, &label)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate labels: %w", err)
	}

	return result, nil
}

// Update updates an existing label
func (r *LabelRepository) Update(ctx context.Context, organizationID string, label *labels.Label) (*labels.Label, error) {
	_, err := r.store.pool.Exec(ctx, `
		UPDATE labels
		SET name = $3, description = $4, color = $5, updated_at = $6
		WHERE organization_id = $1 AND id = $2
	`, organizationID, label.ID, label.Name, label.Description, label.Color, label.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("update label: %w", err)
	}

	return label, nil
}

// Delete removes a label and all its issue associations
func (r *LabelRepository) Delete(ctx context.Context, organizationID string, labelID labels.ID) error {
	// Delete issue associations first
	_, err := r.store.pool.Exec(ctx, `
		DELETE FROM issue_labels
		WHERE organization_id = $1 AND label_id = $2
	`, organizationID, labelID)
	if err != nil {
		return fmt.Errorf("delete label associations: %w", err)
	}

	// Delete the label
	_, err = r.store.pool.Exec(ctx, `
		DELETE FROM labels
		WHERE organization_id = $1 AND id = $2
	`, organizationID, labelID)
	if err != nil {
		return fmt.Errorf("delete label: %w", err)
	}

	return nil
}

// AddLabelToIssue associates a label with an issue
func (r *LabelRepository) AddLabelToIssue(ctx context.Context, organizationID string, issueID string, labelID labels.ID) error {
	_, err := r.store.pool.Exec(ctx, `
		INSERT INTO issue_labels (organization_id, issue_id, label_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (organization_id, issue_id, label_id) DO NOTHING
	`, organizationID, issueID, labelID)

	if err != nil {
		return fmt.Errorf("add label to issue: %w", err)
	}

	return nil
}

// RemoveLabelFromIssue removes a label association from an issue
func (r *LabelRepository) RemoveLabelFromIssue(ctx context.Context, organizationID string, issueID string, labelID labels.ID) error {
	_, err := r.store.pool.Exec(ctx, `
		DELETE FROM issue_labels
		WHERE organization_id = $1 AND issue_id = $2 AND label_id = $3
	`, organizationID, issueID, labelID)

	if err != nil {
		return fmt.Errorf("remove label from issue: %w", err)
	}

	return nil
}

// GetLabelsForIssue retrieves all labels associated with an issue
func (r *LabelRepository) GetLabelsForIssue(ctx context.Context, organizationID string, issueID string) ([]*labels.Label, error) {
	query := `
		SELECT l.id, l.repository, l.name, l.description, l.color, l.created_at, l.updated_at
		FROM labels l
		INNER JOIN issue_labels il ON l.organization_id = il.organization_id AND l.id = il.label_id
		WHERE il.organization_id = $1 AND il.issue_id = $2
		ORDER BY l.name ASC
	`

	rows, err := r.store.pool.Query(ctx, query, organizationID, issueID)
	if err != nil {
		return nil, fmt.Errorf("query issue labels: %w", err)
	}
	defer rows.Close()

	var result []*labels.Label
	for rows.Next() {
		var label labels.Label
		err := rows.Scan(
			&label.ID,
			&label.Repository,
			&label.Name,
			&label.Description,
			&label.Color,
			&label.CreatedAt,
			&label.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan label: %w", err)
		}
		result = append(result, &label)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate issue labels: %w", err)
	}

	return result, nil
}
