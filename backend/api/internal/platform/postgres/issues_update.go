package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
)

// Update applies issue changes atomically against its previously read version.
func (r *IssueRepository) Update(ctx context.Context, organizationID string, issue *issues.Issue) (*issues.Issue, error) {
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin issue update: %w", err)
	}
	defer tx.Rollback(ctx)
	meta := issue.MetadataUpdate
	if meta.MilestoneID != nil && *meta.MilestoneID != "" {
		var id string
		err := tx.QueryRow(ctx, `SELECT id FROM milestones WHERE organization_id = $1 AND repository = $2 AND id = $3 AND state = 'open' FOR SHARE`,
			organizationID, issue.Repository, *meta.MilestoneID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, issues.ErrInvalidMetadata
		}
		if err != nil {
			return nil, fmt.Errorf("validate issue milestone: %w", err)
		}
	}
	var updatedID string
	err = tx.QueryRow(ctx, `
		WITH previous AS (
			SELECT title, body FROM issues WHERE organization_id = $4 AND id = $5 FOR UPDATE
		), mutated AS (
			UPDATE issues SET title = $1, body = $2, updated_at = $3,
				milestone_id = CASE WHEN $8::text IS NULL THEN milestone_id ELSE NULLIF($8, '') END,
				issue_type = COALESCE($9::text, issue_type), custom_fields = COALESCE($11::jsonb, custom_fields)
			WHERE organization_id = $4 AND id = $5 AND ($6::timestamptz IS NULL OR updated_at = $6)
			AND EXISTS (SELECT 1 FROM previous)
			RETURNING *
		), events AS (
			INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, created_at)
			SELECT m.organization_id, gen_random_uuid()::text, m.id, changes.kind, nullif($7::text, ''), m.updated_at
			FROM mutated m CROSS JOIN previous p
			CROSS JOIN LATERAL (VALUES ('renamed', m.title <> p.title), ('edited', m.body <> p.body), ('metadata_changed', $10::boolean)) changes(kind, changed)
			WHERE changes.changed
		)
		SELECT id FROM mutated`, issue.Title, issue.Body, issue.UpdatedAt, organizationID, issue.ID, issue.ExpectedUpdatedAt, issue.EditorID,
		meta.MilestoneID, meta.Type, meta.HasChanges(), meta.Fields).Scan(&updatedID)
	if errors.Is(err, pgx.ErrNoRows) && issue.ExpectedUpdatedAt != nil {
		return nil, issues.ErrStateConflict
	}
	if err != nil {
		return nil, fmt.Errorf("update issue: %w", err)
	}
	if meta.AssigneeIDs != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM issue_assignees WHERE organization_id = $1 AND issue_id = $2`, organizationID, issue.ID); err != nil {
			return nil, fmt.Errorf("replace issue assignees: %w", err)
		}
	}
	// Keep unchanged labels so they do not fire new-label workflows on every metadata save.
	if meta.LabelIDs != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM issue_labels WHERE organization_id = $1 AND issue_id = $2
			AND NOT (label_id = ANY($3))`, organizationID, issue.ID, meta.LabelIDs); err != nil {
			return nil, fmt.Errorf("remove issue labels: %w", err)
		}
	}
	// Keep unchanged project links so their item IDs and local fields survive Issue edits.
	if meta.ProjectIDs != nil {
		if _, err := tx.Exec(ctx, `WITH open_projects AS MATERIALIZED (
			SELECT p.id FROM organization_projects p JOIN issue_projects ip
			ON (ip.organization_id, ip.project_id) = (p.organization_id, p.id)
			WHERE ip.organization_id = $1 AND ip.issue_id = $2 AND NOT (p.id = ANY($3)) AND NOT p.closed
			ORDER BY p.id FOR KEY SHARE OF p
		)
		DELETE FROM issue_projects WHERE organization_id = $1 AND issue_id = $2
		AND project_id IN (SELECT id FROM open_projects)`, organizationID, issue.ID, meta.ProjectIDs); err != nil {
			return nil, fmt.Errorf("remove issue project links: %w", err)
		}
	}
	if err := insertIssueMetadata(ctx, tx, organizationID, issue, meta); err != nil {
		return nil, err
	}
	if meta.ChangesetIDs != nil {
		if err := updateIssueChangesets(ctx, tx, organizationID, issue, meta.ChangesetIDs); err != nil {
			return nil, err
		}
	}

	updated, err := scanIssue(tx.QueryRow(ctx, `SELECT `+issueColumns+` FROM issues WHERE organization_id = $1 AND id = $2`, organizationID, issue.ID))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit issue update: %w", err)
	}
	return updated, nil
}

func insertIssueMetadata(ctx context.Context, tx pgx.Tx, organizationID string, issue *issues.Issue, meta issues.MetadataUpdate) error {
	if len(meta.AssigneeIDs) != 0 {
		inserted, err := tx.Exec(ctx, `INSERT INTO issue_assignees (organization_id, issue_id, user_id)
			SELECT $1, $2, user_id FROM organization_memberships
			WHERE organization_id = $1 AND status = 'active' AND user_id = ANY($3) FOR SHARE`, organizationID, issue.ID, meta.AssigneeIDs)
		if err != nil {
			return fmt.Errorf("insert issue assignees: %w", err)
		}
		if inserted.RowsAffected() != int64(len(meta.AssigneeIDs)) {
			return issues.ErrInvalidMetadata
		}
	}
	if len(meta.LabelIDs) != 0 {
		var matched int
		err := tx.QueryRow(ctx, `WITH valid AS MATERIALIZED (
			SELECT id FROM labels WHERE organization_id = $1 AND id = ANY($3) AND repository = $4 FOR KEY SHARE
		), linked AS (
			INSERT INTO issue_labels (organization_id, issue_id, label_id)
			SELECT $1, $2, id FROM valid ON CONFLICT DO NOTHING
		)
		SELECT count(*) FROM valid`, organizationID, issue.ID, meta.LabelIDs, issue.Repository).Scan(&matched)
		if err != nil {
			return fmt.Errorf("insert issue labels: %w", err)
		}
		if matched != len(meta.LabelIDs) {
			return issues.ErrInvalidMetadata
		}
	}
	if len(meta.ProjectIDs) != 0 {
		var matched int
		err := tx.QueryRow(ctx, `WITH projects AS MATERIALIZED (
			SELECT p.id FROM organization_projects p WHERE p.organization_id = $1 AND p.id = ANY($3)
			AND (p.repository IS NULL OR p.repository = $4) AND (NOT p.closed OR EXISTS (
				SELECT 1 FROM issue_projects ip WHERE ip.organization_id = $1 AND ip.project_id = p.id AND ip.issue_id = $2
			)) ORDER BY p.id FOR KEY SHARE
		), linked AS (
			INSERT INTO issue_projects (organization_id, issue_id, project_id)
			SELECT $1, $2, id FROM projects ON CONFLICT DO NOTHING
		)
		SELECT count(*) FROM projects`, organizationID, issue.ID, meta.ProjectIDs, issue.Repository).Scan(&matched)
		if err != nil {
			return fmt.Errorf("link issue projects: %w", err)
		}
		if matched != len(meta.ProjectIDs) {
			return issues.ErrInvalidMetadata
		}
	}
	return nil
}

// updateIssueChangesets runs after the issue row has been locked and version-checked.
func updateIssueChangesets(ctx context.Context, tx pgx.Tx, organizationID string, issue *issues.Issue, ids []string) error {
	var matched int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM (
		SELECT id FROM delivery_changesets WHERE organization_id = $1 AND repository = $2 AND id = ANY($3) FOR KEY SHARE
	) valid`, organizationID, issue.Repository, ids).Scan(&matched); err != nil {
		return fmt.Errorf("validate issue changesets: %w", err)
	}
	if matched != len(ids) {
		return issues.ErrInvalidMetadata
	}
	_, err := tx.Exec(ctx, `WITH removed AS (
		DELETE FROM issue_changeset_links WHERE organization_id = $1 AND issue_id = $2 AND NOT (changeset_id = ANY($3)) RETURNING changeset_id
	), linked AS (
		INSERT INTO issue_changeset_links (organization_id, issue_id, changeset_id, linked_by)
		SELECT $1, $2, id, $4 FROM unnest($3::text[]) ids(id) ON CONFLICT DO NOTHING RETURNING changeset_id
	)
	INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, metadata)
	SELECT $1, gen_random_uuid()::text, $2, kind, $4, jsonb_build_object('changeset_id', changeset_id)
	FROM (SELECT 'linked_changeset' kind, changeset_id FROM linked
	      UNION ALL SELECT 'unlinked_changeset', changeset_id FROM removed) changes`, organizationID, issue.ID, ids, issue.EditorID)
	if err != nil {
		return fmt.Errorf("update linked issue changesets: %w", err)
	}
	return nil
}
