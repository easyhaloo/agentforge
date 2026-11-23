package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

func (r *IssueRepository) MovedIssue(ctx context.Context, org, repository string, number int) (*issues.Issue, error) {
	return scanIssue(r.store.pool.QueryRow(ctx, `SELECT `+issueColumns+`
		FROM issues WHERE (organization_id, id) = (
			SELECT organization_id, issue_id FROM issue_redirects
			WHERE organization_id = $1 AND repository = $2 AND number = $3
		)`, org, repository, number))
}

func (r *IssueRepository) Transfer(ctx context.Context, scope issues.DetailScope, destination string, expected time.Time) (*issues.Issue, error) {
	if !scope.CanManage {
		return nil, issues.ErrDetailForbidden
	}
	if scope.Repository == destination {
		return nil, issues.ErrInvalidMetadata
	}
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin issue transfer: %w", err)
	}
	defer tx.Rollback(ctx)

	org := scope.OrganizationID
	var id string
	var updated time.Time
	err = tx.QueryRow(ctx, `SELECT id, updated_at FROM issues
		WHERE organization_id = $1 AND repository = $2 AND number = $3 FOR UPDATE`,
		org, scope.Repository, scope.Number).Scan(&id, &updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, issues.ErrDetailNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock issue for transfer: %w", err)
	}
	if !expected.Equal(updated) {
		return nil, issues.ErrTransferConflict
	}
	var related bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issue_parents
		WHERE organization_id = $1 AND repository = $2 AND ($3 = child_id OR $3 = parent_id))`,
		org, scope.Repository, id).Scan(&related); err != nil {
		return nil, fmt.Errorf("check issue family before transfer: %w", err)
	}
	if related {
		return nil, issues.ErrTransferRelated
	}

	var number int
	if err := tx.QueryRow(ctx, `INSERT INTO resource_number_counters (organization_id, repository, last_number)
		VALUES ($1, $2, 1) ON CONFLICT (organization_id, repository) DO UPDATE
		SET last_number = resource_number_counters.last_number + 1 RETURNING last_number`, org, destination).Scan(&number); err != nil {
		return nil, fmt.Errorf("allocate transferred issue number: %w", err)
	}

	var batch pgx.Batch
	batch.Queue(`INSERT INTO issue_redirects (organization_id, repository, number, issue_id) VALUES ($1, $2, $3, $4)`, org, scope.Repository, scope.Number, id)
	batch.Queue(`UPDATE issues SET repository = $3, number = $4, milestone_id = NULL, updated_at = clock_timestamp(), version = version + 1
		WHERE organization_id = $1 AND id = $2`, org, id, destination, number)
	batch.Queue(`DELETE FROM issue_labels WHERE organization_id = $1 AND issue_id = $2`, org, id)
	batch.Queue(`DELETE FROM issue_commit_links WHERE organization_id = $1 AND issue_id = $2`, org, id)
	batch.Queue(`DELETE FROM issue_changeset_links WHERE organization_id = $1 AND issue_id = $2`, org, id)
	batch.Queue(`DELETE FROM issue_projects ip USING organization_projects p
		WHERE (p.organization_id, p.id) = (ip.organization_id, ip.project_id)
		AND ip.organization_id = $1 AND ip.issue_id = $2 AND p.repository IS NOT NULL`, org, id)
	batch.Queue(`UPDATE issue_attachments SET repository = $3 WHERE organization_id = $1 AND issue_id = $2`, org, id, destination)
	batch.Queue(`UPDATE notifications SET repository = $3, issue_number = $4 WHERE organization_id = $1 AND issue_id = $2`, org, id, destination, number)
	batch.Queue(`INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, metadata)
		VALUES ($1, gen_random_uuid()::text, $2, 'transferred', $3, jsonb_build_object('source_repository', $4::text, 'source_number', $5::int))`,
		org, id, scope.UserID, scope.Repository, scope.Number)
	if err := tx.SendBatch(ctx, &batch).Close(); err != nil {
		return nil, fmt.Errorf("move issue resources: %w", err)
	}
	issue, err := scanIssue(tx.QueryRow(ctx, `SELECT `+issueColumns+` FROM issues WHERE organization_id = $1 AND id = $2`, org, id))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit issue transfer: %w", err)
	}
	return issue, nil
}
