package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const projectFieldColumns = `id::text, name, field_type, options`

func listProjectFields(ctx context.Context, tx pgx.Tx, org, projectID string, version int64) (issues.ProjectFieldDefinitions, error) {
	rows, err := tx.Query(ctx, `SELECT `+projectFieldColumns+` FROM project_fields WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at, id`, org, projectID)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, fmt.Errorf("query project fields: %w", err)
	}
	fields, err := pgx.AppendRows([]issues.ProjectField{}, rows, pgx.RowToStructByPos[issues.ProjectField])
	if err != nil {
		return issues.ProjectFieldDefinitions{}, fmt.Errorf("read project fields: %w", err)
	}
	return issues.ProjectFieldDefinitions{ProjectVersion: version, Fields: fields}, nil
}

func readProjectField(ctx context.Context, tx pgx.Tx, org, projectID, fieldID string) (issues.ProjectField, error) {
	var field issues.ProjectField
	err := tx.QueryRow(ctx, `SELECT `+projectFieldColumns+` FROM project_fields WHERE organization_id = $1 AND project_id = $2 AND id = $3`, org, projectID, fieldID).
		Scan(&field.ID, &field.Name, &field.Type, &field.Options)
	if errors.Is(err, pgx.ErrNoRows) {
		return field, issues.ErrProjectNotFound
	}
	if err != nil {
		return field, fmt.Errorf("read project field: %w", err)
	}
	return field, nil
}

func (s *Store) ListProjectFields(ctx context.Context, org string, number int) (issues.ProjectFieldDefinitions, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, fmt.Errorf("begin project fields read: %w", err)
	}
	defer tx.Rollback(ctx)
	id, _, version, _, err := lockProject(ctx, tx, org, number, false)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, err
	}
	return listProjectFields(ctx, tx, org, id, version)
}

func lockProjectForFieldDefinition(ctx context.Context, tx pgx.Tx, org string, number int, expectedVersion int64) (string, error) {
	projectID, _, version, closed, err := lockProject(ctx, tx, org, number, true)
	if err != nil {
		return "", err
	}
	if closed {
		return "", issues.ErrProjectClosed
	}
	if version != expectedVersion {
		return "", issues.ErrProjectConflict
	}
	return projectID, nil
}

func saveProjectFieldOptions(ctx context.Context, tx pgx.Tx, org, projectID string, field issues.ProjectField, options []issues.ProjectFieldOption) error {
	remaining := make(map[string]bool, len(field.Options))
	for _, option := range field.Options {
		remaining[option.ID] = true
	}
	for i, option := range options {
		if option.ID == "" {
			options[i].ID = uuid.NewString()
			continue
		}
		if !remaining[option.ID] {
			return issues.ErrProjectInvalid
		}
		delete(remaining, option.ID)
	}
	if len(remaining) == 0 {
		return nil
	}
	removed := make([]string, 0, len(remaining))
	for id := range remaining {
		removed = append(removed, id)
	}
	var inUse bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM project_field_values
		WHERE organization_id = $1 AND project_id = $2 AND field_id = $3 AND (value #>> '{}') = ANY($4))`, org, projectID, field.ID, removed).Scan(&inUse)
	if err != nil {
		return fmt.Errorf("check project field option usage: %w", err)
	}
	if inUse {
		return issues.ErrProjectFieldOptionUsed
	}
	return nil
}

func (s *Store) SaveProjectField(ctx context.Context, org string, number int, fieldID string, input issues.ProjectFieldInput) (issues.ProjectFieldDefinitions, error) {
	if err := input.Normalize(); err != nil {
		return issues.ProjectFieldDefinitions{}, err
	}
	input.Options = append(make([]issues.ProjectFieldOption, 0, len(input.Options)), input.Options...)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, fmt.Errorf("begin project field save: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, err := lockProjectForFieldDefinition(ctx, tx, org, number, input.ProjectVersion)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, err
	}
	var existing issues.ProjectField
	if fieldID != "" {
		existing, err = readProjectField(ctx, tx, org, projectID, fieldID)
		if err != nil {
			return issues.ProjectFieldDefinitions{}, err
		}
		if input.Type != existing.Type {
			return issues.ProjectFieldDefinitions{}, issues.ErrProjectInvalid
		}
	}
	if err := saveProjectFieldOptions(ctx, tx, org, projectID, existing, input.Options); err != nil {
		return issues.ProjectFieldDefinitions{}, err
	}
	if fieldID == "" {
		_, err = tx.Exec(ctx, `INSERT INTO project_fields (organization_id, project_id, name, field_type, options) VALUES ($1, $2, $3, $4, $5)`, org, projectID, input.Name, input.Type, input.Options)
	} else {
		_, err = tx.Exec(ctx, `UPDATE project_fields SET name = $4, options = $5 WHERE organization_id = $1 AND project_id = $2 AND id = $3`, org, projectID, fieldID, input.Name, input.Options)
	}
	if err != nil {
		var constraint *pgconn.PgError
		if errors.As(err, &constraint) && constraint.Code == "23505" && constraint.ConstraintName == "project_fields_unique_name" {
			return issues.ProjectFieldDefinitions{}, issues.ErrProjectFieldNameInUse
		}
		return issues.ProjectFieldDefinitions{}, fmt.Errorf("save project field: %w", err)
	}
	return commitProjectFieldDefinitions(ctx, tx, org, projectID)
}

func (s *Store) DeleteProjectField(ctx context.Context, org string, number int, fieldID string, version int64) (issues.ProjectFieldDefinitions, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, fmt.Errorf("begin project field deletion: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, err := lockProjectForFieldDefinition(ctx, tx, org, number, version)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, err
	}
	result, err := tx.Exec(ctx, `DELETE FROM project_fields WHERE organization_id = $1 AND project_id = $2 AND id = $3`, org, projectID, fieldID)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, fmt.Errorf("delete project field: %w", err)
	}
	if result.RowsAffected() == 0 {
		return issues.ProjectFieldDefinitions{}, issues.ErrProjectNotFound
	}
	return commitProjectFieldDefinitions(ctx, tx, org, projectID)
}

func commitProjectFieldDefinitions(ctx context.Context, tx pgx.Tx, org, projectID string) (issues.ProjectFieldDefinitions, error) {
	var version int64
	err := tx.QueryRow(ctx, `UPDATE organization_projects SET version = version + 1, updated_at = now()
		WHERE organization_id = $1 AND id = $2 RETURNING version`, org, projectID).Scan(&version)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, fmt.Errorf("bump project version for fields: %w", err)
	}
	fields, err := listProjectFields(ctx, tx, org, projectID, version)
	if err != nil {
		return issues.ProjectFieldDefinitions{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return issues.ProjectFieldDefinitions{}, fmt.Errorf("commit project fields: %w", err)
	}
	return fields, nil
}

func readFieldValues(ctx context.Context, tx pgx.Tx, org, projectID, itemID string, itemVersion int64) (issues.ProjectFieldValues, error) {
	rows, err := tx.Query(ctx, `SELECT field_id::text, value FROM project_field_values WHERE organization_id = $1 AND project_id = $2 AND item_id = $3`, org, projectID, itemID)
	if err != nil {
		return issues.ProjectFieldValues{}, fmt.Errorf("query project item field values: %w", err)
	}
	defer rows.Close()
	values := make(map[string]json.RawMessage)
	for rows.Next() {
		var id string
		var value json.RawMessage
		if err := rows.Scan(&id, &value); err != nil {
			return issues.ProjectFieldValues{}, fmt.Errorf("read project item field value: %w", err)
		}
		values[id] = value
	}
	if err := rows.Err(); err != nil {
		return issues.ProjectFieldValues{}, fmt.Errorf("read project item field values: %w", err)
	}
	return issues.ProjectFieldValues{ItemVersion: itemVersion, Values: values}, nil
}

// Lock the item for a consistent version/value snapshot and validate its canonical
// source against the project's repository scope. Drafts have no repository source.
func lockProjectItemForFieldValues(ctx context.Context, tx pgx.Tx, org, projectID, scope, itemID string) (issues.ProjectItem, error) {
	item, err := readProjectItem(ctx, tx, org, projectID, itemID, true)
	if err != nil {
		return item, err
	}
	if item.Kind != "draft" && (item.Repository == "" || (scope != "" && item.Repository != scope)) {
		return item, issues.ErrProjectNotFound
	}
	return item, nil
}

func (s *Store) ListProjectFieldValues(ctx context.Context, org string, number int, itemID string) (issues.ProjectFieldValues, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.ProjectFieldValues{}, fmt.Errorf("begin project item field values read: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, scope, _, _, err := lockProject(ctx, tx, org, number, false)
	if err != nil {
		return issues.ProjectFieldValues{}, err
	}
	item, err := lockProjectItemForFieldValues(ctx, tx, org, projectID, scope, itemID)
	if err != nil {
		return issues.ProjectFieldValues{}, err
	}
	return readFieldValues(ctx, tx, org, projectID, itemID, item.Version)
}

func (s *Store) PutProjectFieldValue(ctx context.Context, org string, number int, itemID, fieldID string, input issues.ProjectFieldValueInput) (issues.ProjectFieldValues, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.ProjectFieldValues{}, fmt.Errorf("begin project item field value update: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, scope, err := lockWritableProject(ctx, tx, org, number)
	if err != nil {
		return issues.ProjectFieldValues{}, err
	}
	item, err := lockProjectItemForFieldValues(ctx, tx, org, projectID, scope, itemID)
	if err != nil {
		return issues.ProjectFieldValues{}, err
	}
	if item.Archived {
		return issues.ProjectFieldValues{}, issues.ErrProjectItemArchived
	}
	if input.ItemVersion != item.Version {
		return issues.ProjectFieldValues{}, issues.ErrProjectConflict
	}
	field, err := readProjectField(ctx, tx, org, projectID, fieldID)
	if err != nil {
		return issues.ProjectFieldValues{}, err
	}
	if err := field.ValidateValue(input.Value); err != nil {
		return issues.ProjectFieldValues{}, err
	}
	if bytes.Equal(bytes.TrimSpace(input.Value), []byte("null")) {
		_, err = tx.Exec(ctx, `DELETE FROM project_field_values WHERE organization_id = $1 AND project_id = $2 AND item_id = $3 AND field_id = $4`, org, projectID, itemID, fieldID)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO project_field_values (organization_id, project_id, item_id, field_id, value) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (organization_id, project_id, item_id, field_id) DO UPDATE SET value = EXCLUDED.value`, org, projectID, itemID, fieldID, input.Value)
	}
	if err != nil {
		return issues.ProjectFieldValues{}, fmt.Errorf("write project item field value: %w", err)
	}
	var version int64
	err = tx.QueryRow(ctx, `UPDATE project_items SET version = version + 1 WHERE organization_id = $1 AND project_id = $2 AND id = $3 RETURNING version`, org, projectID, itemID).Scan(&version)
	if err != nil {
		return issues.ProjectFieldValues{}, fmt.Errorf("bump project item version for field value: %w", err)
	}
	values, err := readFieldValues(ctx, tx, org, projectID, itemID, version)
	if err != nil {
		return issues.ProjectFieldValues{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return issues.ProjectFieldValues{}, fmt.Errorf("commit project item field value: %w", err)
	}
	return values, nil
}
