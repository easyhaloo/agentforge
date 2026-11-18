package postgres

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

// PromoteIntegration records the exact actor decision, verifies the current Changeset gates,
// and moves the target only while the matching database state is locked.
func (s *Store) PromoteIntegration(ctx context.Context, org, id, actor, sha string, git execution.PromotionProvider) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	run, err := scanRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM pipeline_runs WHERE organization_id=$1 AND id::text=$2 FOR UPDATE`, org, id))
	if err != nil {
		return err
	}
	candidate := run.Integration
	if candidate == nil || sha != candidate.CandidateSHA || run.Status != "succeeded" {
		return pipeline.ErrConflict
	}
	var allowed bool
	err = tx.QueryRow(ctx, `SELECT true FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id JOIN delivery_repositories d ON d.organization_id=o.id WHERE o.id=$1 AND o.status='active' AND m.status='active' AND m.user_id=$2 AND m.role IN ('owner','admin') AND d.slug=$3 AND d.default_branch=$4 FOR SHARE OF m,o,d`, org, actor, candidate.Repository, candidate.Target.Ref).Scan(&allowed)
	if errors.Is(err, pgx.ErrNoRows) {
		return execution.ErrTriggerDenied
	}
	if err != nil {
		return err
	}
	var promoted bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT FROM integration_promotions WHERE run_id=$1)`, id).Scan(&promoted); err != nil || promoted {
		return err
	}
	commits, err := git.CandidateCommits(ctx, org, candidate.Repository, candidate.MergePreview)
	if err != nil {
		return err
	}
	// ponytail: a table lock prevents revisions from entering the candidate set during promotion.
	// Replace with a per-repository write lock on all Changeset mutation paths if contention matters.
	if _, err = tx.Exec(ctx, `LOCK TABLE delivery_changesets IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT state FROM delivery_changesets WHERE organization_id=$1 AND repository=$2 AND EXISTS (SELECT FROM jsonb_array_elements(COALESCE(NULLIF(state->'revisions','null'::jsonb),'[]'::jsonb)) r WHERE r->>'commit_sha'=ANY($3::text[]))`, org, candidate.Repository, commits)
	if err != nil {
		return err
	}
	changesets, err := pgx.CollectRows(rows, pgx.RowTo[delivery.Changeset])
	if err != nil {
		return err
	}
	for _, c := range changesets {
		revision, ok := c.CurrentRevision()
		if !ok || !slices.Contains(commits, revision.CommitSHA) {
			return pipeline.ErrConflict
		}
		evaluation, ok := c.LatestEvaluation(revision.ID)
		if !ok || evaluation.BaseSHA != candidate.Target.SHA {
			return pipeline.ErrConflict
		}
		if err = c.CompleteMerge(delivery.ID(id), actor, candidate.Target.Ref, sha, time.Now().UTC()); err != nil {
			return pipeline.ErrConflict
		}
		if _, err = tx.Exec(ctx, `UPDATE delivery_changesets SET state=$3,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`, org, string(c.ID), c); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO integration_promotions(run_id,candidate_sha,actor_id) VALUES($1,$2,$3)`, id, sha, actor); err != nil {
		return err
	}
	if err = runEvent(ctx, tx, id, "promoted", "", actor); err != nil {
		return err
	}
	if err = git.PromoteCandidate(ctx, org, candidate.Repository, id, candidate.MergePreview); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
