package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/workspace"
	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateWorkspace(ctx context.Context, input workspace.Workspace) (workspace.Workspace, error) {
	if strings.TrimSpace(input.OrganizationID) == "" || strings.TrimSpace(input.ID) == "" {
		return workspace.Workspace{}, workspace.ErrInvalidInput
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO delivery_workspaces
			(organization_id, id, repository, owner_id, base_commit_sha, base_ref, status, expires_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, input.OrganizationID, input.ID, input.Repository, input.OwnerID, input.BaseCommitSHA, input.BaseRef,
		string(input.Status), input.ExpiresAt, input.CreatedAt, input.UpdatedAt)
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("create workspace: %w", err)
	}
	return input, nil
}

func (s *Store) GetWorkspace(ctx context.Context, organizationID, id string) (workspace.Workspace, error) {
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(id) == "" {
		return workspace.Workspace{}, workspace.ErrInvalidInput
	}
	var item workspace.Workspace
	var status string
	err := s.pool.QueryRow(ctx, `
		SELECT id, organization_id, repository, owner_id, base_commit_sha, base_ref, status, expires_at, created_at, updated_at
		FROM delivery_workspaces WHERE organization_id=$1 AND id=$2
	`, organizationID, id).Scan(&item.ID, &item.OrganizationID, &item.Repository, &item.OwnerID,
		&item.BaseCommitSHA, &item.BaseRef, &status, &item.ExpiresAt, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return workspace.Workspace{}, pgx.ErrNoRows
	}
	if err != nil {
		return workspace.Workspace{}, fmt.Errorf("get workspace: %w", err)
	}
	item.Status = workspace.Status(status)
	return item, nil
}

func (s *Store) GetWorkspaceFile(ctx context.Context, organizationID, workspaceID, filePath string) (workspace.File, error) {
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(workspaceID) == "" || !workspace.ValidPath(filePath) {
		return workspace.File{}, workspace.ErrInvalidInput
	}
	var item workspace.File
	err := s.pool.QueryRow(ctx, `
		SELECT workspace_id, path, content, sha256, version, updated_by, updated_at
		FROM delivery_workspace_files
		WHERE organization_id=$1 AND workspace_id=$2 AND path=$3
	`, organizationID, workspaceID, filePath).Scan(&item.WorkspaceID, &item.Path, &item.Content,
		&item.SHA256, &item.Version, &item.UpdatedBy, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return workspace.File{}, pgx.ErrNoRows
	}
	if err != nil {
		return workspace.File{}, fmt.Errorf("get workspace file: %w", err)
	}
	return item, nil
}

func (s *Store) PutWorkspaceFile(ctx context.Context, organizationID string, item workspace.File, expectedVersion int64) (workspace.File, error) {
	if strings.TrimSpace(organizationID) == "" || item.WorkspaceID == "" || !workspace.ValidPath(item.Path) ||
		len(item.Content) > workspace.MaxFileBytes || item.Version < 1 || item.SHA256 == "" || item.UpdatedBy == "" {
		return workspace.File{}, workspace.ErrInvalidInput
	}
	var stored workspace.File
	var err error
	if expectedVersion == 0 {
		err = s.pool.QueryRow(ctx, `
			INSERT INTO delivery_workspace_files
				(organization_id, workspace_id, path, content, sha256, version, updated_by, updated_at)
			SELECT $1,$2,$3,$4,$5,1,$6,$7
			WHERE EXISTS (
				SELECT 1 FROM delivery_workspaces
				WHERE organization_id=$1 AND id=$2 AND status='active' AND expires_at > now()
			)
			ON CONFLICT (organization_id, workspace_id, path) DO NOTHING
			RETURNING workspace_id, path, content, sha256, version, updated_by, updated_at
		`, organizationID, item.WorkspaceID, item.Path, item.Content, item.SHA256, item.UpdatedBy, item.UpdatedAt).
			Scan(&stored.WorkspaceID, &stored.Path, &stored.Content, &stored.SHA256, &stored.Version, &stored.UpdatedBy, &stored.UpdatedAt)
	} else if expectedVersion > 0 {
		err = s.pool.QueryRow(ctx, `
			UPDATE delivery_workspace_files
			SET content=$4, sha256=$5, version=version+1, updated_by=$6, updated_at=$7
			WHERE organization_id=$1 AND workspace_id=$2 AND path=$3 AND version=$8
			  AND EXISTS (
				SELECT 1 FROM delivery_workspaces
				WHERE organization_id=$1 AND id=$2 AND status='active' AND expires_at > now()
			  )
			RETURNING workspace_id, path, content, sha256, version, updated_by, updated_at
		`, organizationID, item.WorkspaceID, item.Path, item.Content, item.SHA256, item.UpdatedBy, item.UpdatedAt, expectedVersion).
			Scan(&stored.WorkspaceID, &stored.Path, &stored.Content, &stored.SHA256, &stored.Version, &stored.UpdatedBy, &stored.UpdatedAt)
	} else {
		return workspace.File{}, workspace.ErrInvalidInput
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return workspace.File{}, workspace.ErrVersionConflict
	}
	if err != nil {
		return workspace.File{}, fmt.Errorf("put workspace file: %w", err)
	}
	return stored, nil
}

func (s *Store) ListWorkspaceFiles(ctx context.Context, organizationID, workspaceID string) ([]workspace.FileEntry, error) {
	if strings.TrimSpace(organizationID) == "" || strings.TrimSpace(workspaceID) == "" {
		return nil, workspace.ErrInvalidInput
	}
	rows, err := s.pool.Query(ctx, `
		SELECT path, sha256, version, updated_by, updated_at
		FROM delivery_workspace_files
		WHERE organization_id=$1 AND workspace_id=$2
		ORDER BY path COLLATE "C" ASC
	LIMIT $3
	`, organizationID, workspaceID, workspace.MaxWorkspaceFiles+1)
	if err != nil {
		return nil, fmt.Errorf("list workspace files: %w", err)
	}
	defer rows.Close()
	items := make([]workspace.FileEntry, 0)
	for rows.Next() {
		var item workspace.FileEntry
		var updatedAt time.Time
		if err := rows.Scan(&item.Path, &item.SHA256, &item.Version, &item.UpdatedBy, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan workspace file: %w", err)
		}
		item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspace files: %w", err)
	}
	if len(items) > workspace.MaxWorkspaceFiles {
		return nil, workspace.ErrTooLarge
	}
	return items, nil
}

var _ workspace.Repository = (*Store)(nil)
