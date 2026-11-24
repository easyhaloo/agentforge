package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
)

const projectItemSelect = `SELECT pi.id,
	CASE WHEN pi.issue_id IS NOT NULL THEN 'issue' WHEN pi.pull_request_id IS NOT NULL THEN 'pull_request' ELSE 'draft' END,
	coalesce(i.title, pr.title, pi.draft_title), pi.draft_body, coalesce(i.repository, pr.repository, ''), coalesce(i.number, 0),
	coalesce(pi.pull_request_id, ''), pi.status,
	pi.priority, coalesce(to_char(pi.start_date, 'YYYY-MM-DD'), ''), coalesce(to_char(pi.target_date, 'YYYY-MM-DD'), ''),
	pi.iteration, pi.archived, pi.version,
	coalesce((SELECT jsonb_object_agg(fv.field_id, fv.value) FROM project_field_values fv
		WHERE (fv.organization_id, fv.project_id, fv.item_id) = (pi.organization_id, pi.project_id, pi.id)), '{}'::jsonb)
	FROM project_items pi
	LEFT JOIN enabled_repository_issues i ON (i.organization_id, i.id) = (pi.organization_id, pi.issue_id)
	LEFT JOIN delivery_changesets pr ON (pr.organization_id, pr.id) = (pi.organization_id, pi.pull_request_id)
	WHERE pi.organization_id = $1 AND pi.project_id = $2 AND (pi.issue_id IS NULL OR i.id IS NOT NULL)`

func (s *Store) ListProjectItems(ctx context.Context, organizationID string, number int, archived bool) ([]issues.ProjectItem, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin project item read: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, _, _, _, err := lockProject(ctx, tx, organizationID, number, false)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, projectItemSelect+` AND pi.archived = $3 ORDER BY pi.created_at, pi.id`, organizationID, projectID, archived)
	if err != nil {
		return nil, fmt.Errorf("query project items: %w", err)
	}
	items, err := pgx.AppendRows(make([]issues.ProjectItem, 0), rows, pgx.RowToStructByPos[issues.ProjectItem])
	if err != nil {
		return nil, fmt.Errorf("read project items: %w", err)
	}
	return items, nil
}

func readProjectItem(ctx context.Context, tx pgx.Tx, org, projectID, id string, lock bool) (issues.ProjectItem, error) {
	query := projectItemSelect + ` AND pi.id = $3`
	if lock {
		query += ` FOR UPDATE OF pi`
	}
	rows, err := tx.Query(ctx, query, org, projectID, id)
	if err != nil {
		return issues.ProjectItem{}, fmt.Errorf("query project item: %w", err)
	}
	item, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[issues.ProjectItem])
	if errors.Is(err, pgx.ErrNoRows) {
		return issues.ProjectItem{}, issues.ErrProjectNotFound
	}
	if err != nil {
		return issues.ProjectItem{}, fmt.Errorf("read project item: %w", err)
	}
	return item, nil
}

func commitProjectItem(ctx context.Context, tx pgx.Tx, org, projectID, id string) (issues.ProjectItem, error) {
	item, err := readProjectItem(ctx, tx, org, projectID, id, false)
	if err != nil {
		return issues.ProjectItem{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return issues.ProjectItem{}, fmt.Errorf("commit project item: %w", err)
	}
	return item, nil
}

func lockWritableProject(ctx context.Context, tx pgx.Tx, org string, number int) (string, string, error) {
	id, scope, _, closed, err := lockProject(ctx, tx, org, number, false)
	if err == nil && closed {
		err = issues.ErrProjectClosed
	}
	return id, scope, err
}

func lockItemRepository(ctx context.Context, tx pgx.Tx, org, repository string) error {
	var slug string
	err := tx.QueryRow(ctx, `SELECT slug FROM delivery_repositories WHERE organization_id = $1 AND slug = $2 FOR KEY SHARE`, org, repository).Scan(&slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return issues.ErrProjectNotFound
	}
	if err != nil {
		return fmt.Errorf("lock project item repository: %w", err)
	}
	return nil
}

func (s *Store) AddProjectItem(ctx context.Context, org string, number int, input issues.ProjectItemInput) (issues.ProjectItem, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.ProjectItem{}, false, fmt.Errorf("begin project item addition: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, scope, err := lockWritableProject(ctx, tx, org, number)
	if err != nil {
		return issues.ProjectItem{}, false, err
	}
	if input.Kind != "draft" {
		if scope != "" && scope != input.Repository {
			return issues.ProjectItem{}, false, issues.ErrProjectInvalid
		}
		if err := lockItemRepository(ctx, tx, org, input.Repository); err != nil {
			return issues.ProjectItem{}, false, err
		}
	}
	var id string
	created := true
	switch input.Kind {
	case "draft":
		err = tx.QueryRow(ctx, `INSERT INTO project_items (organization_id, project_id, draft_title, draft_body)
			VALUES ($1, $2, $3, coalesce($4, '')) RETURNING id`, org, projectID, input.Title, input.DraftBody).Scan(&id)
	case "issue":
		if err := requireRepositoryIssues(ctx, tx, org, input.Repository); err != nil {
			return issues.ProjectItem{}, false, err
		}
		var issueID string
		err = tx.QueryRow(ctx, `SELECT id FROM issues WHERE organization_id = $1 AND repository = $2 AND number = $3 FOR SHARE`,
			org, input.Repository, input.Number).Scan(&issueID)
		if err != nil {
			break
		}
		result, insertErr := tx.Exec(ctx, `INSERT INTO issue_projects (organization_id, issue_id, project_id) VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING`, org, issueID, projectID)
		if insertErr != nil {
			err = insertErr
			break
		}
		created = result.RowsAffected() != 0
		err = tx.QueryRow(ctx, `SELECT id FROM project_items WHERE organization_id = $1 AND project_id = $2 AND issue_id = $3`,
			org, projectID, issueID).Scan(&id)
	case "pull_request":
		var sourceID string
		err = tx.QueryRow(ctx, `SELECT id FROM delivery_changesets WHERE organization_id = $1 AND repository = $2 AND id = $3
			AND state ? 'pull_request' FOR KEY SHARE`, org, input.Repository, input.SourceID).Scan(&sourceID)
		if err != nil {
			break
		}
		result, insertErr := tx.Exec(ctx, `INSERT INTO project_items (organization_id, project_id, pull_request_id) VALUES ($1, $2, $3)
			ON CONFLICT (organization_id, project_id, pull_request_id) DO NOTHING`, org, projectID, sourceID)
		if insertErr != nil {
			err = insertErr
			break
		}
		created = result.RowsAffected() != 0
		err = tx.QueryRow(ctx, `SELECT id FROM project_items WHERE organization_id = $1 AND project_id = $2 AND pull_request_id = $3`,
			org, projectID, sourceID).Scan(&id)
	default:
		return issues.ProjectItem{}, false, issues.ErrProjectInvalid
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return issues.ProjectItem{}, false, issues.ErrProjectNotFound
	}
	if err != nil {
		return issues.ProjectItem{}, false, fmt.Errorf("add project item: %w", err)
	}
	// Explicit placement takes precedence over the default workflow only for new items.
	if created && (input.Status != nil || input.Priority != nil) {
		_, err = tx.Exec(ctx, `UPDATE project_items SET status = coalesce($4, status), priority = coalesce($5, priority)
			WHERE organization_id = $1 AND project_id = $2 AND id = $3`, org, projectID, id, input.Status, input.Priority)
		if err != nil {
			return issues.ProjectItem{}, false, fmt.Errorf("apply initial project item fields: %w", err)
		}
	}
	item, err := commitProjectItem(ctx, tx, org, projectID, id)
	return item, created, err
}

func (s *Store) PatchProjectItem(ctx context.Context, org string, number int, id string, patch issues.ProjectItemPatch) (issues.ProjectItem, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.ProjectItem{}, fmt.Errorf("begin project item update: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, _, err := lockWritableProject(ctx, tx, org, number)
	if err != nil {
		return issues.ProjectItem{}, err
	}
	item, err := readProjectItem(ctx, tx, org, projectID, id, true)
	if err != nil {
		return issues.ProjectItem{}, err
	}
	if item.Version != patch.Version {
		return issues.ProjectItem{}, issues.ErrProjectConflict
	}
	if (patch.Title != nil || patch.DraftBody != nil) && item.Kind != "draft" {
		return issues.ProjectItem{}, issues.ErrProjectInvalid
	}
	if patch.StartDate != nil {
		item.StartDate = *patch.StartDate
	}
	if patch.TargetDate != nil {
		item.TargetDate = *patch.TargetDate
	}
	if item.StartDate != "" && item.TargetDate != "" && item.StartDate > item.TargetDate {
		return issues.ProjectItem{}, issues.ErrProjectInvalid
	}
	_, err = tx.Exec(ctx, `UPDATE project_items SET draft_title = coalesce($4, draft_title), status = coalesce($5, status),
		priority = coalesce($6, priority), start_date = nullif($7, '')::date, target_date = nullif($8, '')::date,
		iteration = coalesce($9, iteration), archived = coalesce($10, archived), draft_body = coalesce($11, draft_body), version = version + 1
		WHERE organization_id = $1 AND project_id = $2 AND id = $3`, org, projectID, id, patch.Title,
		patch.Status, patch.Priority, item.StartDate, item.TargetDate, patch.Iteration, patch.Archived, patch.DraftBody)
	if err != nil {
		return issues.ProjectItem{}, fmt.Errorf("update project item: %w", err)
	}
	return commitProjectItem(ctx, tx, org, projectID, id)
}

func (s *Store) DeleteProjectItem(ctx context.Context, org string, number int, id string, version int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin project item deletion: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, _, err := lockWritableProject(ctx, tx, org, number)
	if err != nil {
		return err
	}
	// Legacy unlink takes the association lock before the cascading item lock.
	// A draft can concurrently convert, so recheck under the item lock below.
	var issueID *string
	err = tx.QueryRow(ctx, `SELECT issue_id FROM project_items pi WHERE organization_id = $1 AND project_id = $2 AND id = $3
		AND (issue_id IS NULL OR EXISTS (SELECT 1 FROM enabled_repository_issues i
			WHERE (i.organization_id, i.id) = (pi.organization_id, pi.issue_id)))`, org, projectID, id).Scan(&issueID)
	if errors.Is(err, pgx.ErrNoRows) {
		return issues.ErrProjectNotFound
	}
	if err != nil {
		return fmt.Errorf("lookup project item source: %w", err)
	}
	if issueID != nil {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM issue_projects WHERE organization_id = $1 AND project_id = $2 AND issue_id = $3 FOR UPDATE`, org, projectID, issueID); err != nil {
			return fmt.Errorf("lock issue project link: %w", err)
		}
	}
	var currentIssueID *string
	var currentVersion int64
	err = tx.QueryRow(ctx, `SELECT issue_id, version FROM project_items WHERE organization_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`, org, projectID, id).Scan(&currentIssueID, &currentVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return issues.ErrProjectNotFound
	}
	if err != nil {
		return fmt.Errorf("lock project item for removal: %w", err)
	}
	if version != currentVersion || (currentIssueID != nil && issueID == nil) {
		return issues.ErrProjectConflict
	}
	if issueID != nil {
		_, err = tx.Exec(ctx, `DELETE FROM issue_projects WHERE organization_id = $1 AND project_id = $2 AND issue_id = $3`, org, projectID, issueID)
	} else {
		_, err = tx.Exec(ctx, `DELETE FROM project_items WHERE organization_id = $1 AND project_id = $2 AND id = $3`, org, projectID, id)
	}
	if err != nil {
		return fmt.Errorf("remove project item: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit project item removal: %w", err)
	}
	return nil
}

func (s *Store) ConvertProjectItem(ctx context.Context, org string, number int, id string, version int64, issue *issues.Issue) (issues.ProjectItem, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.ProjectItem{}, fmt.Errorf("begin draft conversion: %w", err)
	}
	defer tx.Rollback(ctx)
	projectID, scope, err := lockWritableProject(ctx, tx, org, number)
	if err != nil {
		return issues.ProjectItem{}, err
	}
	if scope != "" && scope != issue.Repository {
		return issues.ProjectItem{}, issues.ErrProjectInvalid
	}
	if err := lockItemRepository(ctx, tx, org, issue.Repository); err != nil {
		return issues.ProjectItem{}, err
	}
	item, err := readProjectItem(ctx, tx, org, projectID, id, true)
	if err != nil {
		return issues.ProjectItem{}, err
	}
	if item.Version != version {
		return issues.ProjectItem{}, issues.ErrProjectConflict
	}
	if item.Kind != "draft" {
		return issues.ProjectItem{}, issues.ErrProjectInvalid
	}
	issue.Title = item.Title
	issue.Body = item.DraftBody
	issue.ProjectIDs = []string{projectID}
	_, err = tx.Exec(ctx, `UPDATE project_items SET draft_title = NULL, draft_body = '', issue_id = $4, version = version + 1
		WHERE organization_id = $1 AND project_id = $2 AND id = $3`, org, projectID, id, issue.ID)
	if err != nil {
		return issues.ProjectItem{}, fmt.Errorf("claim project item for conversion: %w", err)
	}
	if _, err := s.createIssueInTx(ctx, tx, org, issue); err != nil {
		return issues.ProjectItem{}, fmt.Errorf("create issue from project draft: %w", err)
	}
	return commitProjectItem(ctx, tx, org, projectID, id)
}
