package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/issues"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const projectColumns = `p.id, p.name, coalesce(p.repository, ''), EXISTS (
	SELECT 1 FROM issue_projects ip JOIN enabled_repository_issues i ON i.organization_id = ip.organization_id AND i.id = ip.issue_id
	WHERE ip.organization_id = p.organization_id AND ip.project_id = p.id
	AND i.created_by = $3 AND i.created_at > now() - interval '30 days'
), p.number, p.layout, coalesce(p.default_repository, ''), p.created_at, p.updated_at,
	p.description, p.readme, p.closed, p.version, ARRAY(SELECT pr.repository FROM project_repositories pr
		WHERE pr.organization_id = p.organization_id AND pr.project_id = p.id ORDER BY pr.repository), p.views, p.workflows`

func scanProject(row pgx.CollectableRow) (issues.Project, error) {
	return pgx.RowToStructByPos[issues.Project](row)
}

func getIssueProject(ctx context.Context, db interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, organizationID string, number int, actorID string) (issues.Project, error) {
	rows, err := db.Query(ctx, `SELECT `+projectColumns+` FROM organization_projects p
		WHERE p.organization_id = $1 AND p.number = $2`, organizationID, number, actorID)
	if err != nil {
		return issues.Project{}, fmt.Errorf("query project: %w", err)
	}
	project, err := pgx.CollectExactlyOneRow(rows, scanProject)
	if errors.Is(err, pgx.ErrNoRows) {
		return issues.Project{}, issues.ErrProjectNotFound
	}
	if err != nil {
		return issues.Project{}, fmt.Errorf("read project: %w", err)
	}
	return project, nil
}

func (s *Store) GetIssueProject(ctx context.Context, organizationID string, number int, actorID string) (issues.Project, error) {
	return getIssueProject(ctx, s.pool, organizationID, number, actorID)
}

func (s *Store) ListIssueProjects(ctx context.Context, organizationID, repository, linkedRepository, actorID string) ([]issues.Project, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+projectColumns+` FROM organization_projects p
	WHERE p.organization_id = $1 AND ($2 = '' OR p.repository IS NULL OR p.repository = $2)
	AND ($4 = '' OR EXISTS (SELECT 1 FROM project_repositories pr WHERE pr.organization_id = p.organization_id
		AND pr.project_id = p.id AND pr.repository = $4))
	ORDER BY lower(p.name), p.id`, organizationID, repository, actorID, linkedRepository)
	if err != nil {
		return nil, fmt.Errorf("query issue projects: %w", err)
	}
	items, err := pgx.AppendRows(make([]issues.Project, 0), rows, scanProject)
	if err != nil {
		return nil, fmt.Errorf("read issue projects: %w", err)
	}
	return items, nil
}

func projectSettingsError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch {
		case pgErr.Code == "23505" && pgErr.ConstraintName == "organization_projects_name":
			return issues.ErrProjectNameInUse
		case pgErr.Code == "23503":
			return issues.ErrProjectInvalid
		}
	}
	return err
}

func replaceProjectRepositories(ctx context.Context, tx pgx.Tx, organizationID, projectID string, repositories []string) error {
	_, err := tx.Exec(ctx, `DELETE FROM project_repositories WHERE organization_id = $1 AND project_id = $2`, organizationID, projectID)
	if err != nil {
		return fmt.Errorf("remove linked project repositories: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO project_repositories (organization_id, project_id, repository)
		SELECT $1, $2, slug FROM unnest($3::text[]) AS repos(slug)`, organizationID, projectID, repositories)
	if err != nil {
		return fmt.Errorf("link project repositories: %w", projectSettingsError(err))
	}
	return nil
}

func (s *Store) CreateIssueProject(ctx context.Context, organizationID string, project issues.Project) (issues.Project, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.Project{}, fmt.Errorf("begin project creation: %w", err)
	}
	defer tx.Rollback(ctx)
	var number int
	if err := tx.QueryRow(ctx, `UPDATE organizations SET last_project_number = last_project_number + 1
		WHERE id = $1 RETURNING last_project_number`, organizationID).Scan(&number); err != nil {
		return issues.Project{}, fmt.Errorf("allocate project number: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO organization_projects
		(organization_id, id, name, repository, number, layout, default_repository, description, readme, views)
		VALUES ($1, $2, $3, nullif($4, ''), $5, $6, nullif($7, ''), $8, $9, $10::jsonb)`,
		organizationID, project.ID, project.Name, project.Repository, number, project.Layout,
		project.DefaultRepository, project.Description, project.Readme, project.Views)
	if err != nil {
		return issues.Project{}, fmt.Errorf("create issue project: %w", projectSettingsError(err))
	}
	if err := replaceProjectRepositories(ctx, tx, organizationID, project.ID, project.Repositories); err != nil {
		return issues.Project{}, err
	}
	return commitProject(ctx, tx, organizationID, number, "")
}

// Key-share locks keep the project alive during item writes. Settings writes can
// proceed without changing a project's identity or repository scope.
func lockProject(ctx context.Context, tx pgx.Tx, organizationID string, number int, exclusive bool) (id, repository string, version int64, closed bool, err error) {
	query := `SELECT id, coalesce(repository, ''), version, closed FROM organization_projects WHERE organization_id = $1 AND number = $2`
	if exclusive {
		query += ` FOR UPDATE`
	} else {
		query += ` FOR KEY SHARE`
	}
	err = tx.QueryRow(ctx, query, organizationID, number).Scan(&id, &repository, &version, &closed)
	if errors.Is(err, pgx.ErrNoRows) {
		err = issues.ErrProjectNotFound
	} else if err != nil {
		err = fmt.Errorf("lock project: %w", err)
	}
	return
}

func commitProject(ctx context.Context, tx pgx.Tx, organizationID string, number int, actorID string) (issues.Project, error) {
	project, err := getIssueProject(ctx, tx, organizationID, number, actorID)
	if err != nil {
		return issues.Project{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return issues.Project{}, fmt.Errorf("commit project settings: %w", err)
	}
	return project, nil
}

func (s *Store) PatchIssueProject(ctx context.Context, organizationID string, number int, actorID string, input issues.ProjectPatch) (issues.Project, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return issues.Project{}, fmt.Errorf("begin project update: %w", err)
	}
	defer tx.Rollback(ctx)
	id, scope, version, closed, err := lockProject(ctx, tx, organizationID, number, true)
	if err != nil {
		return issues.Project{}, err
	}
	if version != input.Version {
		return issues.Project{}, issues.ErrProjectConflict
	}
	if closed && input.Workflows != nil {
		return issues.Project{}, issues.ErrProjectClosed
	}
	if scope != "" && input.DefaultRepository != nil && *input.DefaultRepository != "" && *input.DefaultRepository != scope {
		return issues.Project{}, issues.ErrProjectInvalid
	}
	if input.Workflows != nil && input.Workflows.AutoAdd != nil {
		rule := input.Workflows.AutoAdd
		if scope != "" && scope != rule.Repository {
			return issues.Project{}, issues.ErrProjectInvalid
		}
		var valid bool
		err := tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM delivery_repositories r WHERE r.organization_id = $1 AND r.slug = $2
			AND ($3 <> 'issue' OR NOT r.issues_disabled)
			AND ($4 = '' OR EXISTS (SELECT 1 FROM labels l
				WHERE (l.organization_id, l.repository, l.id) = (r.organization_id, r.slug, $4)))
		)`, organizationID, rule.Repository, rule.Kind, rule.LabelID).Scan(&valid)
		if err != nil {
			return issues.Project{}, fmt.Errorf("validate automatic project addition: %w", err)
		}
		if !valid {
			return issues.Project{}, issues.ErrProjectInvalid
		}
	}
	var layout *issues.ProjectLayout
	var views any
	if input.Views != nil {
		if len(*input.Views) == 0 {
			return issues.Project{}, issues.ErrProjectInvalid
		}
		views = *input.Views
		layout = &(*input.Views)[0].Layout
	}
	_, err = tx.Exec(ctx, `UPDATE organization_projects SET name = coalesce($3, name), description = coalesce($4, description),
		readme = coalesce($5, readme), closed = coalesce($6, closed),
		default_repository = CASE WHEN $7::text IS NULL THEN default_repository ELSE nullif($7, '') END,
		views = coalesce($8::jsonb, views), layout = coalesce($9, layout),
		workflows = coalesce($10::jsonb, workflows), version = version + 1, updated_at = clock_timestamp()
		WHERE organization_id = $1 AND id = $2`, organizationID, id, input.Name, input.Description, input.Readme, input.Closed, input.DefaultRepository, views, layout, input.Workflows)
	if err != nil {
		return issues.Project{}, fmt.Errorf("update project settings: %w", projectSettingsError(err))
	}
	if input.Repositories != nil {
		if err := replaceProjectRepositories(ctx, tx, organizationID, id, *input.Repositories); err != nil {
			return issues.Project{}, err
		}
	}
	return commitProject(ctx, tx, organizationID, number, actorID)
}

func (s *Store) DeleteIssueProject(ctx context.Context, organizationID string, number int, expectedVersion int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin project deletion: %w", err)
	}
	defer tx.Rollback(ctx)
	id, _, version, _, err := lockProject(ctx, tx, organizationID, number, true)
	if err != nil {
		return err
	}
	if version != expectedVersion {
		return issues.ErrProjectConflict
	}
	if _, err := tx.Exec(ctx, `DELETE FROM organization_projects WHERE organization_id = $1 AND id = $2`, organizationID, id); err != nil {
		return fmt.Errorf("delete project: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit project deletion: %w", err)
	}
	return nil
}
