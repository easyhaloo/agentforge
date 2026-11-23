package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

// Close closes an issue with a specific reason.
func (r *IssueRepository) Close(ctx context.Context, organizationID string, issueID issues.ID, reason issues.StateReason, closedBy string, closedAt time.Time) (*issues.Issue, error) {
	issue, err := scanIssue(r.store.pool.QueryRow(ctx, `
		WITH mutated AS (
			UPDATE issues SET state = 'closed', state_reason = $1, closed_by = $2, closed_at = $3, updated_at = $3
			WHERE organization_id = $4 AND id = $5 AND state = 'open' RETURNING *
		), event AS (
			INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, metadata, created_at)
			SELECT organization_id, gen_random_uuid()::text, id, 'closed', closed_by, jsonb_build_object('reason', state_reason), updated_at FROM mutated
		)
		SELECT `+issueColumns+` FROM mutated AS issues`, reason, closedBy, closedAt, organizationID, issueID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, issues.ErrStateConflict
	}
	return issue, err
}

// Reopen restores the open state and clears closure metadata atomically.
func (r *IssueRepository) Reopen(ctx context.Context, organizationID string, issueID issues.ID, actorID string, updatedAt time.Time) (*issues.Issue, error) {
	issue, err := scanIssue(r.store.pool.QueryRow(ctx, `
		WITH mutated AS (
			UPDATE issues SET state = 'open', state_reason = NULL, closed_by = NULL, closed_at = NULL, updated_at = $1
			WHERE organization_id = $2 AND id = $3 AND state = 'closed' RETURNING *
		), event AS (
			INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, created_at)
			SELECT organization_id, gen_random_uuid()::text, id, 'reopened', $4, updated_at FROM mutated
		)
		SELECT `+issueColumns+` FROM mutated AS issues`, updatedAt, organizationID, issueID, actorID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, issues.ErrStateConflict
	}
	return issue, err
}

// The merge caller holds the repository policy lock through this transaction.
func closeMergedPullIssues(ctx context.Context, tx pgx.Tx, org string, c *delivery.Changeset, target, actor string) error {
	if c.PullRequest == nil {
		return nil
	}
	refs := issues.ClosingIssueReferences(c.PullRequest.Description)
	return closeMergedIssues(ctx, tx, org, c.Repository, target, actor, c.CreatedBy, string(c.ID), refs, "")
}

func closeMergedCommitIssues(ctx context.Context, tx pgx.Tx, git *delivery.LocalGitProvider, org, repo, target, base, head, actor string) error {
	var enabled bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM delivery_repositories
		WHERE organization_id=$1 AND slug=$2 AND default_branch=$3
		AND NOT issues_disabled AND NOT auto_close_issues_disabled)`, org, repo, target).Scan(&enabled)
	if err != nil || !enabled {
		return err
	}
	return git.VisitPushedCommits(ctx, org, repo, base, head, func(sha, _, message string) error {
		refs := issues.ClosingIssueReferences(message)
		if len(refs) == 0 {
			return nil
		}
		return closeMergedIssues(ctx, tx, org, repo, target, actor, actor, "", refs, sha)
	})
}

func closeMergedIssues(ctx context.Context, tx pgx.Tx, org, repo, target, actor, referenceAuthor, changesetID string, refs []issues.ClosingReference, sha string) error {
	_, err := tx.Exec(ctx, `WITH source AS (
		SELECT organization_id, slug FROM delivery_repositories
		WHERE organization_id=$1 AND slug=$2 AND default_branch=$4
			AND NOT issues_disabled AND NOT auto_close_issues_disabled
	), targets AS (
		SELECT l.organization_id, l.issue_id, i.repository FROM source s
		JOIN issue_changeset_links l ON l.organization_id=s.organization_id AND l.changeset_id=$3
		JOIN issues i ON (i.organization_id,i.id,i.repository)=(l.organization_id,l.issue_id,s.slug)
		UNION
		SELECT i.organization_id, i.id, i.repository FROM source s
		CROSS JOIN jsonb_to_recordset(COALESCE(NULLIF($6::jsonb,'null'),'[]')) AS ref(repository text,number int)
		JOIN delivery_repositories r ON lower(r.slug)=COALESCE(NULLIF(ref.repository,''),lower(s.slug))
		JOIN organizations o ON o.id=r.organization_id AND o.status='active'
		JOIN issues i ON (i.organization_id,i.repository,i.number)=(r.organization_id,r.slug,ref.number)
		WHERE NOT r.issues_disabled AND NOT r.auto_close_issues_disabled AND (
			(r.organization_id,r.slug)=(s.organization_id,s.slug)
			OR (ref.repository<>'' AND r.organization_id=COALESCE(
				(SELECT id FROM organizations WHERE slug=split_part(ref.repository,'/',1)), s.organization_id)
				AND EXISTS (SELECT 1 FROM organization_memberships m
					WHERE m.organization_id=r.organization_id AND m.user_id=$7 AND m.status='active'
					AND (m.role IN ('owner','admin') OR i.created_by=$7)))
		)
	), locked AS (
		SELECT i.organization_id, i.id FROM issues i JOIN targets t ON (t.organization_id,t.issue_id,t.repository)=(i.organization_id,i.id,i.repository)
		WHERE i.state='open' ORDER BY i.organization_id, i.id FOR UPDATE OF i
	), closed AS (
		UPDATE issues i SET state='closed', state_reason='completed', closed_by=$5,
			closed_at=statement_timestamp(), updated_at=statement_timestamp(), version=i.version+1
		FROM locked l WHERE (i.organization_id,i.id)=(l.organization_id,l.id)
		RETURNING i.organization_id, i.id, i.updated_at
	)
	INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, metadata, created_at)
	SELECT organization_id, gen_random_uuid()::text, id, 'closed', $5,
		jsonb_strip_nulls(jsonb_build_object('reason', 'completed',
			'changeset_id', NULLIF($3::text,''), 'commit_sha', NULLIF($8::text,''))), updated_at FROM closed`,
		org, repo, changesetID, target, actor, refs, referenceAuthor, sha)
	if err != nil {
		return fmt.Errorf("close issues for default branch merge: %w", err)
	}
	return nil
}
