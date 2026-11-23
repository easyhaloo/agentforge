package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

func (r *IssueRepository) StageAttachment(ctx context.Context, organizationID string, file issues.AttachmentDraft) error {
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin attachment upload: %w", err)
	}
	defer tx.Rollback(ctx)
	// Serialize quota checks for concurrent uploads by the same organization member.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, organizationID, file.UploaderID); err != nil {
		return fmt.Errorf("lock attachment quota: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM issue_attachments WHERE issue_id IS NULL AND expires_at <= now()`); err != nil {
		return fmt.Errorf("expire unused attachments: %w", err)
	}
	var pendingCount, pendingBytes int64
	if err := tx.QueryRow(ctx, `SELECT count(*), coalesce(sum(octet_length(content)), 0) FROM issue_attachments
		WHERE organization_id = $1 AND uploader_id = $2 AND issue_id IS NULL`, organizationID, file.UploaderID).Scan(&pendingCount, &pendingBytes); err != nil {
		return fmt.Errorf("read attachment quota: %w", err)
	}
	if pendingCount >= 100 || pendingBytes+int64(len(file.Content)) > 100<<20 {
		return issues.ErrAttachmentQuota
	}
	if _, err := tx.Exec(ctx, `INSERT INTO issue_attachments (organization_id, id, repository, uploader_id, filename, content_type, content)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, organizationID, file.ID, file.Repository, file.UploaderID, file.Filename, file.ContentType, file.Content); err != nil {
		return fmt.Errorf("insert attachment: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit attachment: %w", err)
	}
	return nil
}

func (r *IssueRepository) GetAttachment(ctx context.Context, organizationID, userID, id string) (issues.AttachmentDraft, error) {
	file := issues.AttachmentDraft{ID: id}
	err := r.store.pool.QueryRow(ctx, `SELECT repository, filename, content_type, content FROM issue_attachments
		WHERE organization_id = $1 AND id = $2 AND (issue_id IS NOT NULL OR (uploader_id = $3 AND expires_at > now()))`,
		organizationID, id, userID).Scan(&file.Repository, &file.Filename, &file.ContentType, &file.Content)
	if errors.Is(err, pgx.ErrNoRows) {
		return file, issues.ErrAttachmentNotFound
	}
	if err != nil {
		return file, fmt.Errorf("read attachment: %w", err)
	}
	return file, nil
}
