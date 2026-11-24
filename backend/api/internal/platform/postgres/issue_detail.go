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

type issueDetailQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func scopedIssue(ctx context.Context, db issueDetailQuerier, scope issues.DetailScope, number int, lock bool) (id, author string, err error) {
	query := `SELECT id, created_by FROM enabled_repository_issues WHERE organization_id = $1 AND repository = $2 AND number = $3`
	if lock {
		query += ` FOR KEY SHARE`
	}
	err = db.QueryRow(ctx, query, scope.OrganizationID, scope.Repository, number).Scan(&id, &author)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", issues.ErrDetailNotFound
	}
	if err != nil {
		return "", "", fmt.Errorf("resolve scoped issue: %w", err)
	}
	return id, author, nil
}

func (r *IssueRepository) GitHubSource(ctx context.Context, scope issues.DetailScope) (*issues.GitHubSource, error) {
	var source *issues.GitHubSource
	err := r.store.pool.QueryRow(ctx, `SELECT github_source FROM enabled_repository_issues
		WHERE organization_id = $1 AND repository = $2 AND number = $3`,
		scope.OrganizationID, scope.Repository, scope.Number).Scan(&source)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, issues.ErrDetailNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read GitHub issue source: %w", err)
	}
	return source, nil
}

func (r *IssueRepository) SetGitHubSource(ctx context.Context, scope issues.DetailScope, source *issues.GitHubSource, expected string) error {
	if !scope.CanManage {
		return issues.ErrDetailForbidden
	}
	tag, err := r.store.pool.Exec(ctx, `UPDATE issues SET github_source = $4
		WHERE organization_id = $1 AND repository = $2 AND number = $3
		AND (github_source->>'fetched_at') IS NOT DISTINCT FROM NULLIF($5, '')
		AND EXISTS (SELECT 1 FROM enabled_repository_issues i
			WHERE i.organization_id = issues.organization_id AND i.id = issues.id)`,
		scope.OrganizationID, scope.Repository, scope.Number, source, expected)
	if err != nil {
		return fmt.Errorf("update GitHub issue source: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return issues.ErrSourceConflict
	}
	return nil
}

// CreateBranch holds the issue at this repository and number until Git finishes.
// A later transfer leaves its Git refs in the original repository.
func (r *IssueRepository) CreateBranch(ctx context.Context, scope issues.DetailScope, write func(issues.ID, delivery.BranchWriteCheck) (delivery.RepositoryRef, error)) (delivery.RepositoryRef, error) {
	if !scope.CanManage {
		return delivery.RepositoryRef{}, issues.ErrDetailForbidden
	}
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return delivery.RepositoryRef{}, fmt.Errorf("begin issue branch creation: %w", err)
	}
	defer tx.Rollback(ctx)
	id, _, err := scopedIssue(ctx, tx, scope, scope.Number, true)
	if err != nil {
		return delivery.RepositoryRef{}, err
	}
	// Take the repository policy lock after the Issue row lock, on the same
	// transaction. Neither native pushes nor merges take an Issue row lock.
	policy, err := lockGitPolicyRow(ctx, tx, scope.OrganizationID, scope.Repository)
	if err != nil {
		return delivery.RepositoryRef{}, err
	}
	return write(issues.ID(id), policy.CheckBranchWrite)
}

func (r *IssueRepository) CreateLinkedPullRequest(ctx context.Context, scope issues.DetailScope, changeset *delivery.Changeset) (delivery.StoredChangeset, error) {
	if !scope.CanManage {
		return delivery.StoredChangeset{}, issues.ErrDetailForbidden
	}
	if changeset == nil || changeset.PullRequest == nil || changeset.Repository != scope.Repository {
		return delivery.StoredChangeset{}, delivery.ErrInvalidInput
	}
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("begin linked pull request: %w", err)
	}
	defer tx.Rollback(ctx)
	org := scope.OrganizationID
	if err := requireRepositoryIssues(ctx, tx, org, scope.Repository); err != nil {
		return delivery.StoredChangeset{}, err
	}
	var issueID string
	err = tx.QueryRow(ctx, `UPDATE issues SET updated_at = clock_timestamp(), version = version + 1
		WHERE organization_id = $1 AND repository = $2 AND number = $3 RETURNING id`, org, scope.Repository, scope.Number).Scan(&issueID)
	if errors.Is(err, pgx.ErrNoRows) {
		return delivery.StoredChangeset{}, issues.ErrDetailNotFound
	}
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("update linked issue: %w", err)
	}
	stored, err := createChangeset(ctx, tx, org, changeset)
	if err != nil {
		return delivery.StoredChangeset{}, err
	}
	_, err = tx.Exec(ctx, `WITH linked AS (
		INSERT INTO issue_changeset_links (organization_id, issue_id, changeset_id, linked_by)
		VALUES ($1, $2, $3, $4) RETURNING changeset_id
	)
	INSERT INTO issue_events (organization_id, id, issue_id, event_type, actor_id, metadata)
	SELECT $1, gen_random_uuid()::text, $2, 'linked_changeset', $4, jsonb_build_object('changeset_id', changeset_id) FROM linked`,
		org, issueID, string(changeset.ID), scope.UserID)
	if err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("link created pull request: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return delivery.StoredChangeset{}, fmt.Errorf("commit linked pull request: %w", err)
	}
	return stored, nil
}

func (r *IssueRepository) Relationships(ctx context.Context, scope issues.DetailScope) (issues.Relationships, error) {
	id, _, err := scopedIssue(ctx, r.store.pool, scope, scope.Number, false)
	if err != nil {
		return issues.Relationships{}, err
	}
	return readIssueRelationships(ctx, r.store.pool, scope, id)
}

func readIssueRelationships(ctx context.Context, db issueDetailQuerier, scope issues.DetailScope, id string) (issues.Relationships, error) {
	result := issues.Relationships{Children: []issues.IssueSummary{}}
	rows, err := db.Query(ctx, `
		SELECT true AS is_parent, i.id, i.number, i.title, i.state FROM issue_parents p
		JOIN enabled_repository_issues i ON (i.organization_id, i.repository, i.id) = (p.organization_id, p.repository, p.parent_id)
		WHERE p.organization_id = $1 AND p.repository = $2 AND p.child_id = $3
		UNION ALL
		SELECT false, i.id, i.number, i.title, i.state FROM issue_parents p
		JOIN enabled_repository_issues i ON (i.organization_id, i.repository, i.id) = (p.organization_id, p.repository, p.child_id)
		WHERE p.organization_id = $1 AND p.repository = $2 AND p.parent_id = $3
		ORDER BY number`, scope.OrganizationID, scope.Repository, id)
	if err != nil {
		return result, fmt.Errorf("read issue relationships: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var summary issues.IssueSummary
		var parent bool
		if err := rows.Scan(&parent, &summary.ID, &summary.Number, &summary.Title, &summary.State); err != nil {
			return result, fmt.Errorf("scan issue relationship: %w", err)
		}
		if parent {
			result.Parent = &summary
		} else {
			result.Children = append(result.Children, summary)
		}
	}
	if err := rows.Err(); err != nil {
		return result, fmt.Errorf("iterate issue relationships: %w", err)
	}
	return result, nil
}

func (r *IssueRepository) SetParent(ctx context.Context, scope issues.DetailScope, parentNumber int) (issues.Relationships, error) {
	var result issues.Relationships
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return result, fmt.Errorf("begin issue relationship update: %w", err)
	}
	defer tx.Rollback(ctx)
	// Serialize graph writes per repository so cycle checks see all preceding links.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('issue-parent:' || $1 || ':' || $2, 0))`, scope.OrganizationID, scope.Repository); err != nil {
		return result, fmt.Errorf("lock issue relationship graph: %w", err)
	}
	child, author, err := scopedIssue(ctx, tx, scope, scope.Number, true)
	if err != nil {
		return result, err
	}
	if !scope.CanManage && scope.UserID != author {
		return result, issues.ErrDetailForbidden
	}

	if parentNumber == 0 {
		var parentAuthor string
		err := tx.QueryRow(ctx, `SELECT i.created_by FROM issue_parents p
			JOIN enabled_repository_issues i ON (i.organization_id, i.repository, i.id) = (p.organization_id, p.repository, p.parent_id)
			WHERE p.organization_id = $1 AND p.repository = $2 AND p.child_id = $3`, scope.OrganizationID, scope.Repository, child).Scan(&parentAuthor)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return result, fmt.Errorf("read current parent: %w", err)
		case !scope.CanManage && scope.UserID != parentAuthor:
			return result, issues.ErrDetailForbidden
		default:
			if _, err := tx.Exec(ctx, `DELETE FROM issue_parents WHERE organization_id = $1 AND repository = $2 AND child_id = $3`,
				scope.OrganizationID, scope.Repository, child); err != nil {
				return result, fmt.Errorf("remove issue parent: %w", err)
			}
		}
	} else {
		parent, author, err := scopedIssue(ctx, tx, scope, parentNumber, true)
		if err != nil {
			return result, err
		}
		if !scope.CanManage && scope.UserID != author {
			return result, issues.ErrDetailForbidden
		}
		if err := linkIssueParent(ctx, tx, scope, child, parent); err != nil {
			return result, err
		}
	}
	result, err = readIssueRelationships(ctx, tx, scope, child)
	if err != nil {
		return result, err
	}
	if err := tx.Commit(ctx); err != nil {
		return result, fmt.Errorf("commit issue relationship update: %w", err)
	}
	return result, nil
}

func linkIssueParent(ctx context.Context, tx pgx.Tx, scope issues.DetailScope, child, parent string) error {
	var existing string
	err := tx.QueryRow(ctx, `SELECT parent_id FROM issue_parents WHERE organization_id = $1 AND repository = $2 AND child_id = $3`,
		scope.OrganizationID, scope.Repository, child).Scan(&existing)
	switch {
	case err == nil && existing == parent:
		return nil
	case err == nil:
		return issues.ErrParentExists
	case !errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("read existing issue parent: %w", err)
	}
	var cycle bool
	err = tx.QueryRow(ctx, `WITH RECURSIVE ancestors(id) AS (
		SELECT $3::text
		UNION
		SELECT p.parent_id FROM issue_parents p JOIN ancestors a ON a.id = p.child_id
		WHERE p.organization_id = $1 AND p.repository = $2
	) SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = $4)`,
		scope.OrganizationID, scope.Repository, parent, child).Scan(&cycle)
	if err != nil {
		return fmt.Errorf("check issue ancestry: %w", err)
	}
	if cycle {
		return issues.ErrParentCycle
	}
	if _, err := tx.Exec(ctx, `INSERT INTO issue_parents (organization_id, repository, child_id, parent_id) VALUES ($1, $2, $3, $4)`,
		scope.OrganizationID, scope.Repository, child, parent); err != nil {
		return fmt.Errorf("link issue parent: %w", err)
	}
	return nil
}

func (r *IssueRepository) Artifacts(ctx context.Context, scope issues.DetailScope) ([]issues.Artifact, error) {
	id, _, err := scopedIssue(ctx, r.store.pool, scope, scope.Number, false)
	if err != nil {
		return nil, err
	}
	rows, err := r.store.pool.Query(ctx, `SELECT id, filename, content_type, octet_length(content)
		FROM issue_attachments WHERE organization_id = $1 AND repository = $2 AND issue_id = $3 AND artifact_owns_binding IS NOT NULL
		ORDER BY filename, id`, scope.OrganizationID, scope.Repository, id)
	if err != nil {
		return nil, fmt.Errorf("read issue artifacts: %w", err)
	}
	files, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (issues.Artifact, error) {
		var file issues.Artifact
		err := row.Scan(&file.ID, &file.Name, &file.ContentType, &file.Size)
		return file, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan issue artifacts: %w", err)
	}
	return files, nil
}

func (r *IssueRepository) SetArtifact(ctx context.Context, scope issues.DetailScope, attachmentID string, linked bool) error {
	tx, err := r.store.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin issue artifact update: %w", err)
	}
	defer tx.Rollback(ctx)
	// Serialize writes to one issue so simultaneous uploads cannot exceed the limit.
	var id, author string
	err = tx.QueryRow(ctx, `SELECT id, created_by FROM enabled_repository_issues WHERE organization_id = $1 AND repository = $2 AND number = $3 FOR NO KEY UPDATE`,
		scope.OrganizationID, scope.Repository, scope.Number).Scan(&id, &author)
	if errors.Is(err, pgx.ErrNoRows) {
		return issues.ErrDetailNotFound
	}
	if err != nil {
		return fmt.Errorf("lock artifact issue: %w", err)
	}
	if !scope.CanManage && scope.UserID != author {
		return issues.ErrDetailForbidden
	}
	if linked {
		if err := linkIssueArtifact(ctx, tx, scope, id, attachmentID); err != nil {
			return err
		}
	} else {
		const unlink = `UPDATE issue_attachments SET artifact_owns_binding = NULL,
			issue_id = CASE WHEN artifact_owns_binding THEN NULL ELSE issue_id END
			WHERE organization_id = $1 AND repository = $2 AND issue_id = $3 AND id = $4 AND artifact_owns_binding IS NOT NULL`
		result, err := tx.Exec(ctx, unlink, scope.OrganizationID, scope.Repository, id, attachmentID)
		if err != nil {
			return fmt.Errorf("unlink issue artifact: %w", err)
		}
		if result.RowsAffected() == 0 {
			return issues.ErrDetailNotFound
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit issue artifact update: %w", err)
	}
	return nil
}

func linkIssueArtifact(ctx context.Context, tx pgx.Tx, scope issues.DetailScope, issueID, attachmentID string) error {
	var alreadyLinked bool
	// Lock the candidate across issues. Once another issue claims it, it no longer matches the draft filter.
	err := tx.QueryRow(ctx, `SELECT artifact_owns_binding IS NOT NULL FROM issue_attachments
		WHERE organization_id = $1 AND repository = $2 AND id = $3
		AND (issue_id = $4 OR (issue_id IS NULL AND uploader_id = $5 AND expires_at > now())) FOR UPDATE`,
		scope.OrganizationID, scope.Repository, attachmentID, issueID, scope.UserID).Scan(&alreadyLinked)
	if errors.Is(err, pgx.ErrNoRows) {
		return issues.ErrDetailNotFound
	}
	if err != nil {
		return fmt.Errorf("lock uploaded artifact: %w", err)
	}
	if alreadyLinked {
		return nil
	}
	var count int
	err = tx.QueryRow(ctx, `SELECT count(*) FROM issue_attachments WHERE organization_id = $1 AND issue_id = $2 AND artifact_owns_binding IS NOT NULL`,
		scope.OrganizationID, issueID).Scan(&count)
	if err != nil {
		return fmt.Errorf("count issue artifacts: %w", err)
	}
	if count >= 20 {
		return issues.ErrArtifactLimit
	}
	if _, err := tx.Exec(ctx, `UPDATE issue_attachments SET artifact_owns_binding = (issue_id IS NULL), issue_id = $4
		WHERE organization_id = $1 AND repository = $2 AND id = $3`, scope.OrganizationID, scope.Repository, attachmentID, issueID); err != nil {
		return fmt.Errorf("link issue artifact: %w", err)
	}
	return nil
}

func (r *IssueRepository) Report(ctx context.Context, scope issues.DetailScope, id, commentID, reason, details string) (issues.ReportReceipt, error) {
	var receipt issues.ReportReceipt
	var createdAt *time.Time
	// Verify the issue/comment and write the private report in one statement. Hold the
	// matched resources until the report is inserted so concurrent deletion has a defined order.
	err := r.store.pool.QueryRow(ctx, `WITH target AS (
		SELECT i.organization_id, i.id FROM enabled_repository_issues i WHERE i.organization_id = $1 AND i.repository = $2 AND i.number = $3
		AND ($6 = '' OR EXISTS (SELECT 1 FROM comments c WHERE c.organization_id = i.organization_id
			AND c.resource_type = 'issue' AND c.resource_id = i.id AND c.id = $6 FOR KEY SHARE))
		FOR KEY SHARE
	), inserted AS (
		INSERT INTO issue_content_reports (organization_id, issue_id, id, reporter_id, comment_id, reason, details)
		SELECT organization_id, id, $4, $5, $6, $7, $8 FROM target
		ON CONFLICT (organization_id, issue_id, reporter_id, comment_id) DO NOTHING
		RETURNING created_at
	) SELECT inserted.created_at FROM target LEFT JOIN inserted ON true`,
		scope.OrganizationID, scope.Repository, scope.Number, id, scope.UserID, commentID, reason, details).Scan(&createdAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return receipt, issues.ErrDetailNotFound
	}
	if err != nil {
		return receipt, fmt.Errorf("persist issue content report: %w", err)
	}
	if createdAt == nil {
		return receipt, issues.ErrDuplicateReport
	}
	return issues.ReportReceipt{ID: id, CreatedAt: *createdAt}, nil
}
