package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/easyhaloo/agentforge/backend/api/internal/notifications"
	"github.com/jackc/pgx/v5"
)

type IssueRepository struct {
	store *Store
}

func NewIssueRepository(store *Store) *IssueRepository {
	return &IssueRepository{store: store}
}

// Create persists the issue and its repository-scoped metadata in the same transaction.
func (r *IssueRepository) Create(ctx context.Context, organizationID string, issue *issues.Issue) (*issues.Issue, error) {
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin issue creation: %w", err)
	}
	defer tx.Rollback(ctx)

	var parentID string
	if issue.ParentNumber > 0 {
		scope := issues.DetailScope{OrganizationID: organizationID, Repository: issue.Repository}
		id, author, err := scopedIssue(ctx, tx, scope, issue.ParentNumber, true)
		if err != nil {
			return nil, err
		}
		if !issue.ParentCanManage && author != issue.CreatedBy {
			return nil, issues.ErrDetailForbidden
		}
		parentID = id
	}

	var number int
	err = tx.QueryRow(ctx, `
		INSERT INTO resource_number_counters (organization_id, repository, last_number)
		VALUES ($1, $2, 1)
		ON CONFLICT (organization_id, repository) DO UPDATE
		SET last_number = resource_number_counters.last_number + 1
		RETURNING last_number`, organizationID, issue.Repository).Scan(&number)
	if err != nil {
		return nil, fmt.Errorf("allocate issue number: %w", err)
	}

	inserted, err := tx.Exec(ctx, `
		INSERT INTO issues (organization_id, id, repository, number, title, body,
			state, created_by, created_at, updated_at, milestone_id, issue_type)
		SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, ''), $12
		WHERE $11 = '' OR EXISTS (
			SELECT 1 FROM milestones WHERE organization_id = $1 AND repository = $3
			AND id = $11 AND state = 'open' FOR SHARE
		)`, organizationID, issue.ID, issue.Repository, number, issue.Title, issue.Body,
		issue.State, issue.CreatedBy, issue.CreatedAt, issue.UpdatedAt, issue.MilestoneID, issue.Type)
	if err != nil {
		return nil, fmt.Errorf("insert issue: %w", err)
	}
	if inserted.RowsAffected() != 1 {
		return nil, issues.ErrInvalidMetadata
	}
	if parentID != "" {
		// The new child is not yet visible to other transactions and cannot be an ancestor.
		if _, err := tx.Exec(ctx, `INSERT INTO issue_parents (organization_id, repository, child_id, parent_id) VALUES ($1, $2, $3, $4)`,
			organizationID, issue.Repository, issue.ID, parentID); err != nil {
			return nil, fmt.Errorf("link new sub-issue: %w", err)
		}
	}
	assigneeIDs := make([]string, 0, len(issue.Assignees))
	for _, assignee := range issue.Assignees {
		assigneeIDs = append(assigneeIDs, assignee.UserID)
	}
	labelIDs := make([]string, 0, len(issue.Labels))
	for _, label := range issue.Labels {
		labelIDs = append(labelIDs, label.ID)
	}
	if err := insertIssueMetadata(ctx, tx, organizationID, issue, issues.MetadataUpdate{
		AssigneeIDs: assigneeIDs, LabelIDs: labelIDs, ProjectIDs: issue.ProjectIDs,
	}); err != nil {
		return nil, err
	}

	if len(issue.AttachmentIDs) > 0 {
		bound, err := tx.Exec(ctx, `UPDATE issue_attachments SET issue_id = $2
			WHERE organization_id = $1 AND repository = $3 AND uploader_id = $4
			AND id = ANY($5) AND issue_id IS NULL AND expires_at > now()`,
			organizationID, issue.ID, issue.Repository, issue.CreatedBy, issue.AttachmentIDs)
		if err != nil {
			return nil, fmt.Errorf("attach uploaded files: %w", err)
		}
		if bound.RowsAffected() != int64(len(issue.AttachmentIDs)) {
			return nil, issues.ErrInvalidAttachments
		}
	}

	if handles := notifications.ParseMentions(issue.Body); len(handles) > 0 {
		_, err := tx.Exec(ctx, `
			INSERT INTO notifications (organization_id, id, user_id, type, reason,
				issue_id, repository, issue_number, issue_title, actor_id, created_at)
			SELECT $1, gen_random_uuid()::text, m.user_id, $7, $8, $2, $3, $4, $5, $6, $9
			FROM organization_memberships m JOIN users u ON u.id = m.user_id
			WHERE m.organization_id = $1 AND m.status = 'active' AND m.user_id <> $6
			  AND u.username = ANY($10)`, organizationID, issue.ID, issue.Repository, number,
			issue.Title, issue.CreatedBy, notifications.TypeMention, notifications.ReasonMentioned, issue.CreatedAt, handles)
		if err != nil {
			return nil, fmt.Errorf("notify mentioned issue members: %w", err)
		}
	}

	created, err := scanIssue(tx.QueryRow(ctx, `SELECT `+issueColumns+`
		FROM issues WHERE organization_id = $1 AND id = $2`, organizationID, issue.ID))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit issue creation: %w", err)
	}
	return created, nil
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
const issueColumns = `id, repository, number, title, body, issue_type, state, COALESCE(state_reason, ''),
	COALESCE(milestone_id, ''), COALESCE((SELECT m.title FROM milestones m
		WHERE m.organization_id = issues.organization_id AND m.id = issues.milestone_id
		  AND m.repository = issues.repository), ''), comments_count, locked, COALESCE(lock_reason, ''), locked_at,
	COALESCE(locked_by, ''), created_by, created_at, updated_at, closed_at, COALESCE(closed_by, ''),
	COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name,
		'description', l.description, 'color', l.color, 'created_at', l.created_at,
		'updated_at', l.updated_at) ORDER BY l.name)
		FROM issue_labels il JOIN labels l ON l.organization_id = il.organization_id AND l.id = il.label_id
		WHERE il.organization_id = issues.organization_id AND il.issue_id = issues.id
		  AND l.repository = issues.repository), '[]'::jsonb),
	COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', a.user_id, 'display_name', u.display_name) ORDER BY a.user_id)
		FROM issue_assignees a JOIN users u ON u.id = a.user_id WHERE a.organization_id = issues.organization_id AND a.issue_id = issues.id), '[]'::jsonb),
	COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', p.id, 'name', p.name, 'number', p.number,
		'repository', p.repository)) ORDER BY lower(p.name), p.id)
		FROM issue_projects ip JOIN organization_projects p ON p.organization_id = ip.organization_id AND p.id = ip.project_id
		WHERE ip.organization_id = issues.organization_id AND ip.issue_id = issues.id), '[]'::jsonb), custom_fields,
	COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) ORDER BY c.title, c.id)
		FROM issue_changeset_links l JOIN delivery_changesets c ON c.organization_id = l.organization_id AND c.id = l.changeset_id
		WHERE l.organization_id = issues.organization_id AND l.issue_id = issues.id AND c.repository = issues.repository), '[]'::jsonb),
	COALESCE((SELECT display_name FROM users WHERE id = issues.created_by), '')`

func scanIssue(row pgx.Row) (*issues.Issue, error) {
	var issue issues.Issue
	if err := row.Scan(
		&issue.ID, &issue.Repository, &issue.Number, &issue.Title, &issue.Body, &issue.Type, &issue.State,
		&issue.StateReason, &issue.MilestoneID, &issue.MilestoneTitle, &issue.CommentsCount, &issue.Locked, &issue.LockReason,
		&issue.LockedAt, &issue.LockedBy, &issue.CreatedBy, &issue.CreatedAt, &issue.UpdatedAt,
		&issue.ClosedAt, &issue.ClosedBy, &issue.Labels, &issue.Assignees, &issue.Projects, &issue.Fields, &issue.Changesets, &issue.CreatedByName,
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

// ExistingNumbers resolves Issue references without loading their full bodies or metadata.
func (r *IssueRepository) ExistingNumbers(ctx context.Context, organizationID, repository string, numbers []int32) ([]int32, error) {
	rows, err := r.store.pool.Query(ctx, `SELECT number FROM issues
		WHERE organization_id = $1 AND repository = $2 AND number = ANY($3) ORDER BY number`, organizationID, repository, numbers)
	if err != nil {
		return nil, fmt.Errorf("query issue numbers: %w", err)
	}
	found, err := pgx.CollectRows(rows, pgx.RowTo[int32])
	if err != nil {
		return nil, fmt.Errorf("read issue numbers: %w", err)
	}
	return found, nil
}

// Lock locks an issue to prevent new comments.
func (r *IssueRepository) Lock(ctx context.Context, organizationID string, issueID issues.ID, reason issues.LockReason, lockedBy string, lockedAt time.Time) (*issues.Issue, error) {
	return scanIssue(r.store.pool.QueryRow(ctx, `
		WITH mutated AS (
			UPDATE issues SET locked = true, lock_reason = $1, locked_at = $2, locked_by = $3, updated_at = $2
			WHERE organization_id = $4 AND id = $5 AND NOT locked RETURNING *
		), event AS (
			INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, metadata, created_at)
			SELECT organization_id, gen_random_uuid()::text, id, 'locked', locked_by, jsonb_build_object('reason', lock_reason), updated_at FROM mutated
		)
		SELECT `+issueColumns+` FROM mutated AS issues`, reason, lockedAt, lockedBy, organizationID, issueID))
}

// Unlock unlocks an issue to allow new comments.
func (r *IssueRepository) Unlock(ctx context.Context, organizationID string, issueID issues.ID, actorID string) (*issues.Issue, error) {
	return scanIssue(r.store.pool.QueryRow(ctx, `
		WITH mutated AS (
			UPDATE issues SET locked = false, lock_reason = NULL, locked_at = NULL, locked_by = NULL, updated_at = now()
			WHERE organization_id = $1 AND id = $2 AND locked RETURNING *
		), event AS (
			INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, created_at)
			SELECT organization_id, gen_random_uuid()::text, id, 'unlocked', $3, updated_at FROM mutated
		)
		SELECT `+issueColumns+` FROM mutated AS issues`, organizationID, issueID, actorID))
}
