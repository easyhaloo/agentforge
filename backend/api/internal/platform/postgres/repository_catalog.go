package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (s *Store) RegisterRepository(ctx context.Context, input delivery.RepositoryMetadata) (delivery.RepositoryMetadata, error) {
	input.OrganizationID = strings.TrimSpace(input.OrganizationID)
	input.Slug = strings.TrimSpace(input.Slug)
	input.DefaultBranch = strings.TrimSpace(input.DefaultBranch)
	input.CreatedBy = strings.TrimSpace(input.CreatedBy)
	if input.OrganizationID == "" || input.Slug == "" || input.DefaultBranch == "" || input.CreatedBy == "" {
		return delivery.RepositoryMetadata{}, delivery.ErrInvalidInput
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO delivery_repositories (organization_id,slug,default_branch,created_by,visibility,fork,description)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at,updated_at,allow_merge_commit,allow_squash_merge,allow_rebase_merge,merge_commit_message_format,squash_commit_message_format
	`, input.OrganizationID, input.Slug, input.DefaultBranch, input.CreatedBy, input.Visibility, input.Fork, input.Description).
		Scan(&input.CreatedAt, &input.UpdatedAt, &input.AllowMergeCommit, &input.AllowSquashMerge, &input.AllowRebaseMerge, &input.MergeCommitMessageFormat, &input.SquashCommitMessageFormat)
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			return delivery.RepositoryMetadata{}, delivery.ErrVersionConflict
		}
		return delivery.RepositoryMetadata{}, fmt.Errorf("register repository: %w", err)
	}
	return input, nil
}

func (s *Store) ListRepositories(ctx context.Context, organizationID string) ([]delivery.RepositoryMetadata, error) {
	if strings.TrimSpace(organizationID) == "" {
		return nil, delivery.ErrInvalidInput
	}
	rows, err := s.pool.Query(ctx, `
		SELECT organization_id,slug,default_branch,created_by,created_at,updated_at,visibility,fork,description,is_template,push_ref_limit,protected_refs,actions_disabled,actions_retention_days,ref_rules,issues_disabled,auto_close_issues_disabled,delete_merged_branches,web_commit_signoff_required,suggest_branch_update,
		       allow_merge_commit,allow_squash_merge,allow_rebase_merge,merge_commit_message_format,squash_commit_message_format
		FROM delivery_repositories WHERE organization_id=$1 ORDER BY slug ASC
	`, organizationID)
	if err != nil {
		return nil, fmt.Errorf("list repositories: %w", err)
	}
	defer rows.Close()
	items := make([]delivery.RepositoryMetadata, 0)
	for rows.Next() {
		var item delivery.RepositoryMetadata
		if err := rows.Scan(
			&item.OrganizationID, &item.Slug, &item.DefaultBranch, &item.CreatedBy,
			&item.CreatedAt, &item.UpdatedAt, &item.Visibility, &item.Fork, &item.Description, &item.IsTemplate, &item.PushRefLimit, &item.ProtectedRefs, &item.ActionsDisabled, &item.ActionsRetentionDays, &item.RefRules, &item.IssuesDisabled, &item.AutoCloseIssuesDisabled, &item.DeleteMergedBranches, &item.WebCommitSignoffRequired, &item.SuggestBranchUpdate,
			&item.AllowMergeCommit, &item.AllowSquashMerge, &item.AllowRebaseMerge, &item.MergeCommitMessageFormat, &item.SquashCommitMessageFormat,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

var _ delivery.RepositoryCatalog = (*Store)(nil)

func (s *Store) SetRepositoryDefaultBranch(ctx context.Context, org, slug, branch, previous string, verifyBranch func() error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin default branch update: %w", err)
	}
	defer tx.Rollback(ctx)
	// The row update excludes Git pushes until the branch is verified and the new setting is visible.
	result, err := tx.Exec(ctx, `UPDATE delivery_repositories SET default_branch=$3, updated_at=clock_timestamp()
		WHERE organization_id=$1 AND slug=$2 AND default_branch=$4`, org, slug, branch, previous)
	if err != nil {
		return fmt.Errorf("update default branch: %w", err)
	}
	if result.RowsAffected() == 0 {
		return delivery.ErrVersionConflict
	}
	if err := verifyBranch(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) SetRepositoryGeneralSettings(ctx context.Context, repository delivery.RepositoryMetadata) (time.Time, error) {
	updated, err := s.PatchRepositoryGeneralSettings(ctx, repository, githttp.MergeMethods{})
	return updated.UpdatedAt, err
}

func (s *Store) PatchRepositoryGeneralSettings(ctx context.Context, repository delivery.RepositoryMetadata, methods githttp.MergeMethods) (delivery.RepositoryMetadata, error) {
	// UPDATE locks the same row used by queue admission, promotion and web merge.
	// The check constraint validates the combined policy, including omitted fields.
	err := s.pool.QueryRow(ctx, `UPDATE delivery_repositories SET description=$3, is_template=$4, push_ref_limit=$6,
    protected_refs=COALESCE($7, '{}'::text[]), actions_disabled=$8, ref_rules=COALESCE(NULLIF($9::jsonb, 'null'::jsonb), '[]'::jsonb),
    issues_disabled=$10, delete_merged_branches=$11, web_commit_signoff_required=$12,
    allow_merge_commit=COALESCE($13, allow_merge_commit), allow_squash_merge=COALESCE($14, allow_squash_merge),
    allow_rebase_merge=COALESCE($15, allow_rebase_merge),
    merge_commit_message_format=COALESCE(NULLIF($16,''), merge_commit_message_format),
    squash_commit_message_format=COALESCE(NULLIF($17,''), squash_commit_message_format),
    actions_retention_days=$18, auto_close_issues_disabled=$19, suggest_branch_update=$20, updated_at=clock_timestamp()
  WHERE organization_id=$1 AND slug=$2 AND updated_at=$5
  RETURNING updated_at, allow_merge_commit, allow_squash_merge, allow_rebase_merge, merge_commit_message_format, squash_commit_message_format`,
		repository.OrganizationID, repository.Slug, repository.Description, repository.IsTemplate, repository.UpdatedAt,
		repository.PushRefLimit, repository.ProtectedRefs, repository.ActionsDisabled, repository.RefRules,
		repository.IssuesDisabled, repository.DeleteMergedBranches, repository.WebCommitSignoffRequired,
		methods.AllowMergeCommit, methods.AllowSquashMerge, methods.AllowRebaseMerge, repository.MergeCommitMessageFormat, repository.SquashCommitMessageFormat, repository.ActionsRetentionDays, repository.AutoCloseIssuesDisabled, repository.SuggestBranchUpdate).
		Scan(&repository.UpdatedAt, &repository.AllowMergeCommit, &repository.AllowSquashMerge, &repository.AllowRebaseMerge, &repository.MergeCommitMessageFormat, &repository.SquashCommitMessageFormat)
	var pgError *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return delivery.RepositoryMetadata{}, delivery.ErrVersionConflict
	case errors.As(err, &pgError) && pgError.Code == "23514" && pgError.ConstraintName == "repository_has_merge_method":
		return delivery.RepositoryMetadata{}, delivery.ErrNoRepositoryMergeMethod
	case err != nil:
		return delivery.RepositoryMetadata{}, fmt.Errorf("update repository settings: %w", err)
	default:
		return repository, nil
	}
}

// Explicit integration and trigger attribution takes precedence over the workflow's repository at admission.
const runRepository = `COALESCE(integration->>'repository', trigger_source->>'repository', repository)`

func (s *Store) RepositoryActivities(ctx context.Context, org string) ([]delivery.RepositoryActivity, error) {
	rows, err := s.pool.Query(ctx, `WITH changes AS (
		SELECT repository, count(*) AS total FROM delivery_changesets WHERE organization_id=$1 GROUP BY repository
	), actions AS (
		SELECT `+runRepository+` AS repository, count(*) AS total FROM pipeline_runs WHERE organization_id=$1 GROUP BY 1
	)
	SELECT r.slug, coalesce(changes.total, 0), coalesce(actions.total, 0) FROM delivery_repositories r
	LEFT JOIN changes ON changes.repository=r.slug LEFT JOIN actions ON actions.repository=r.slug
	WHERE r.organization_id=$1`, org)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[delivery.RepositoryActivity])
}

func (s *Store) ListRepositoryActions(ctx context.Context, org, slug string, filter delivery.RepositoryActionFilter, limit, offset int) ([]delivery.RepositoryAction, error) {
	rows, err := s.pool.Query(ctx, `SELECT r.id, coalesce(v.definition->>'name', p.name), r.status, r.version, r.created_at, r.pipeline_id,
		details.event, details.branch, details.sha, u.display_name, r.actor_id,
		(SELECT e.created_at FROM pipeline_run_events e
		 WHERE r.status NOT IN ('queued','running') AND e.run_id=r.id AND e.step_id IS NULL AND e.kind=r.status ORDER BY e.seq DESC LIMIT 1)
	FROM pipeline_runs r
	JOIN pipelines p ON p.organization_id=r.organization_id AND p.id=r.pipeline_id
	JOIN users u ON u.id=r.actor_id
	JOIN pipeline_versions v ON v.organization_id=r.organization_id AND v.pipeline_id=r.pipeline_id AND v.number=r.version
	CROSS JOIN LATERAL (SELECT
		CASE WHEN r.integration ? 'queueEntry' THEN 'merge_queue'
		     WHEN r.integration IS NOT NULL THEN 'integration'
		     WHEN r.webhook IS NOT NULL THEN 'webhook'
		     ELSE coalesce(r.trigger_source->>'kind', 'manual') END AS event,
		regexp_replace(coalesce(r.integration#>>'{target,ref}', r.webhook->>'ref', ''), '^refs/heads/', '') AS branch,
		coalesce(r.integration->>'candidateSHA', r.trigger_source->>'sha', r.webhook->>'sha', '') AS sha
	) details
	WHERE r.organization_id=$1 AND COALESCE(r.integration->>'repository', r.trigger_source->>'repository', r.repository)=$2
		AND ($3='' OR r.pipeline_id=$3) AND ($4='' OR r.status=$4) AND ($5='' OR details.event=$5)
		AND ($7='' OR lower(details.branch)=lower($7))
		AND ($8='' OR r.actor_id=$8 OR lower(u.display_name)=lower($8))
		AND ($6='' OR strpos(lower(concat_ws(' ', p.name, v.definition->>'name', r.id::text, details.branch, details.sha, u.display_name)), lower($6))>0)
	ORDER BY r.created_at DESC, r.id DESC LIMIT $9 OFFSET $10`, org, slug, filter.Workflow, filter.Status, filter.Event, filter.Query, filter.Branch, filter.Actor, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list repository actions: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[delivery.RepositoryAction])
}

func (s *Store) ListRepositoryWorkflows(ctx context.Context, org, slug string) ([]pipeline.Summary, error) {
	rows, err := s.pool.Query(ctx, `SELECT p.disabled,coalesce(p.repository,''),p.id,p.name,p.status,p.revision,p.version FROM pipelines p
	WHERE p.organization_id=$1 AND (p.repository=$2 OR p.id IN (
		SELECT pipeline_id FROM pipeline_runs WHERE organization_id=$1 AND `+runRepository+`=$2
		UNION ALL
		SELECT pipeline_id FROM pipeline_trigger_bindings WHERE organization_id=$1 AND repository=$2 AND enabled
	)) ORDER BY p.name,p.id`, org, slug)
	if err != nil {
		return nil, fmt.Errorf("list repository workflows: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[pipeline.Summary])
}
