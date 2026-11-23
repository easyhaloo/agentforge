package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

const activeQueue = `status IN ('queued','building','ready')`
const queueFields = `id,repository,target,source_ref,source_sha,status,coalesce(run_id::text,''),candidate_sha`

func lockQueue(ctx context.Context, tx pgx.Tx, org, repo, target string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array($1::text,$2::text,$3::text)::text,613))`, org, repo, target)
	return err
}

func queueEvent(ctx context.Context, tx pgx.Tx, id int64, actor string) error {
	_, err := tx.Exec(ctx, `INSERT INTO merge_queue_events(entry_id,status,run_id,actor) SELECT id,status,run_id,$2 FROM merge_queue_entries WHERE id=$1`, id, actor)
	return err
}

func (s *Store) Enqueue(ctx context.Context, org, pipelineID string, version int, actor string, inputs map[string]json.RawMessage, candidate execution.Integration) (execution.QueueEntry, error) {
	var entry execution.QueueEntry
	if len(candidate.Sources) != 1 {
		return entry, execution.ErrInputs
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return entry, err
	}
	defer tx.Rollback(ctx)
	repo, target := candidate.Repository, candidate.Target.Ref
	if err = lockQueue(ctx, tx, org, repo, target); err != nil {
		return entry, err
	}
	policy, err := lockGitPolicyRow(ctx, tx, org, repo)
	if errors.Is(err, pgx.ErrNoRows) {
		return entry, execution.ErrInputs
	}
	if err != nil {
		return entry, err
	}
	strategy, err := githttp.QueueMergeStrategy(policy.RefRules, target, policy.DefaultBranch)
	if err != nil || strategy != candidate.Strategy || target != policy.DefaultBranch {
		return entry, pipeline.ErrConflict
	}
	if err := policy.MergeMethods.CheckBranch(candidate.Strategy, policy.RefRules, target, policy.DefaultBranch); err != nil {
		return entry, err
	}
	var count int
	var duplicate bool
	err = tx.QueryRow(ctx, `SELECT count(*),coalesce(bool_or(source_sha=$4),false) FROM merge_queue_entries WHERE organization_id=$1 AND repository=$2 AND target=$3 AND `+activeQueue, org, repo, target, candidate.Sources[0].SHA).Scan(&count, &duplicate)
	if err != nil {
		return entry, err
	}
	if duplicate {
		return entry, pipeline.ErrConflict
	}
	if count >= 32 {
		return entry, execution.ErrQuota
	}
	if inputs == nil {
		inputs = map[string]json.RawMessage{}
	}
	if _, err = runDefinition(ctx, tx, org, pipelineID, version, inputs, true); err != nil {
		return entry, err
	}
	if err = checkRepositoryActions(ctx, tx, org, pipelineID, repo); err != nil {
		return entry, err
	}
	if checks := githttp.BranchRequiredWorkflows(policy.RefRules, target, policy.DefaultBranch); len(checks) > 0 {
		if err = checkQueueRequiredWorkflows(ctx, tx, org, candidate, checks); err != nil {
			return entry, err
		}
	}
	var id int64
	err = tx.QueryRow(ctx, `INSERT INTO merge_queue_entries(organization_id,repository,target,pipeline_id,version,actor_id,source_ref,source_sha,inputs) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 FROM delivery_repositories WHERE organization_id=$1 AND slug=$2 AND default_branch=$3 RETURNING id`, org, repo, target, pipelineID, version, actor, candidate.Sources[0].Ref, candidate.Sources[0].SHA, inputs).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return entry, execution.ErrInputs
	}
	if err != nil {
		return entry, err
	}
	if err = queueEvent(ctx, tx, id, actor); err != nil {
		return entry, err
	}
	// A head entry can reuse its admission candidate. Later entries build in FIFO order.
	if count == 0 {
		candidate.QueueEntry = id
		run, err := createRunTx(ctx, tx, org, pipelineID, version, actor, inputs, nil, &candidate, nil)
		if err != nil {
			return entry, err
		}
		if err = attachTrainRun(ctx, tx, id, run); err != nil {
			return entry, err
		}
	}
	rows, err := tx.Query(ctx, `SELECT `+queueFields+` FROM merge_queue_entries WHERE id=$1`, id)
	if err != nil {
		return entry, err
	}
	entry, err = pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[execution.QueueEntry])
	if err != nil {
		return entry, err
	}
	return entry, tx.Commit(ctx)
}

func checkQueueRequiredWorkflows(ctx context.Context, tx pgx.Tx, org string, candidate execution.Integration, checks map[string]bool) error {
	source := candidate.Sources[0]
	noPull := fmt.Errorf("%w: expected exactly one open pull request matching the candidate branches and source commit", githttp.ErrBranchPullRequestRequired)
	if source.SHA == "" || candidate.Target.SHA == "" {
		return execution.ErrInputs
	}
	rows, err := tx.Query(ctx, `SELECT state FROM delivery_changesets
		WHERE organization_id=$1 AND repository=$2
		  AND state->'pull_request'->>'base_branch'=$3 AND state->'pull_request'->>'source_branch'=$4
		  AND state->'pull_request'->>'closed'='false' AND state->>'merge' IS NULL
		  AND state->'revisions'->-1->>'commit_sha'=$5
		LIMIT 2 FOR SHARE`, org, candidate.Repository, candidate.Target.Ref, source.Ref, source.SHA)
	if err != nil {
		return fmt.Errorf("find pull request for queue admission: %w", err)
	}
	pull, err := pgx.CollectExactlyOneRow(rows, pgx.RowTo[delivery.Changeset])
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, pgx.ErrTooManyRows) {
		return noPull
	}
	if err != nil {
		return fmt.Errorf("read pull request for queue admission: %w", err)
	}
	revision, ok := pull.CurrentRevision()
	if !ok || revision.ID == "" || revision.Ref != source.Ref || revision.CommitSHA != source.SHA {
		return noPull
	}
	// Strict status provenance must match the candidate target SHA. This store has
	// no Git provider, so promotion still checks actual target ancestry.
	return checkRequiredWorkflows(ctx, tx, org, &pull, revision, candidate.Target.SHA, checks)
}

func attachTrainRun(ctx context.Context, tx pgx.Tx, id int64, run execution.Run) error {
	_, err := tx.Exec(ctx, `UPDATE merge_queue_entries SET status='building',run_id=$2,candidate_sha=$3,checked_at=now() WHERE id=$1`, id, run.ID, run.Integration.CandidateSHA)
	if err != nil {
		return err
	}
	return queueEvent(ctx, tx, id, "scheduler")
}
func (s *Store) ListQueue(ctx context.Context, org, repo, target string) ([]execution.QueueEntry, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+queueFields+` FROM merge_queue_entries WHERE organization_id=$1 AND repository=$2 AND target=$3 AND `+activeQueue+` ORDER BY id`, org, repo, target)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[execution.QueueEntry])
}

// Release execution quota and fence leased tasks before detaching superseded runs.
func cancelTrainRuns(ctx context.Context, tx pgx.Tx, org, repo, target string, from int64, actor string) error {
	rows, err := tx.Query(ctx, `SELECT r.id FROM pipeline_runs r JOIN merge_queue_entries q ON q.run_id=r.id WHERE q.organization_id=$1 AND q.repository=$2 AND q.target=$3 AND q.id >= $4 AND q.status IN ('building','ready') AND r.status IN ('queued','running') ORDER BY q.id FOR UPDATE OF r`, org, repo, target, from)
	if err != nil {
		return err
	}
	runs, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, run := range runs {
		if err := terminateRun(ctx, tx, run, "cancelled", actor); err != nil {
			return err
		}
	}
	return nil
}

// Discard all later runs in the same transaction that changes the predecessor set.
func invalidateTrain(ctx context.Context, tx pgx.Tx, org, repo, target string, after int64, actor string) error {
	_, err := tx.Exec(ctx, `WITH invalid AS (UPDATE merge_queue_entries SET status='queued',run_id=NULL,candidate_sha='',checked_at='-infinity' WHERE organization_id=$1 AND repository=$2 AND target=$3 AND id>$4 AND status IN ('building','ready') RETURNING id) INSERT INTO merge_queue_events(entry_id,status,actor) SELECT id,'rebuild',$5 FROM invalid`, org, repo, target, after, actor)
	return err
}

// Only the head can promote. A later entry's base check can invalidate the head too.
// Call under lockQueue, before mutating the train.
func headHasPromotion(ctx context.Context, tx pgx.Tx, org, repo, target string, git execution.PromotionReceipts) (bool, error) {
	var run, sha string
	err := tx.QueryRow(ctx, `SELECT coalesce(run_id::text,''),candidate_sha FROM merge_queue_entries WHERE organization_id=$1 AND repository=$2 AND target=$3 AND `+activeQueue+` ORDER BY id LIMIT 1`, org, repo, target).Scan(&run, &sha)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil || run == "" {
		return false, err
	}
	return git.HasPromotion(ctx, org, repo, run, sha)
}
func (s *Store) CancelQueueEntry(ctx context.Context, org string, id int64, actor string, git execution.PromotionReceipts) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var repo, target string
	err = tx.QueryRow(ctx, `SELECT repository,target FROM merge_queue_entries WHERE organization_id=$1 AND id=$2`, org, id).Scan(&repo, &target)
	if errors.Is(err, pgx.ErrNoRows) {
		return pipeline.ErrMissing
	}
	if err != nil {
		return err
	}
	if err = lockQueue(ctx, tx, org, repo, target); err != nil {
		return err
	}
	if pending, err := headHasPromotion(ctx, tx, org, repo, target, git); err != nil {
		return err
	} else if pending {
		return pipeline.ErrConflict
	}
	if err = removeQueueEntry(ctx, tx, org, repo, target, id, "cancelled", actor); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func removeQueueEntry(ctx context.Context, tx pgx.Tx, org, repo, target string, id int64, status, actor string) error {
	if err := cancelTrainRuns(ctx, tx, org, repo, target, id, actor); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE merge_queue_entries SET status=$3 WHERE organization_id=$1 AND id=$2 AND `+activeQueue, org, id, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pipeline.ErrConflict
	}
	if err = queueEvent(ctx, tx, id, actor); err != nil {
		return err
	}
	return invalidateTrain(ctx, tx, org, repo, target, id, actor)
}

// Reconcile one due entry. Transaction locks expire on process exit. A new API process resumes from the durable queue.
func (s *Store) AdvanceQueue(ctx context.Context, git execution.TrainProvider) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id int64
	var org, repo, target string
	err = tx.QueryRow(ctx, `SELECT id,organization_id,repository,target FROM merge_queue_entries WHERE `+activeQueue+` AND checked_at<now()-interval '3 seconds' ORDER BY checked_at,id LIMIT 1`).Scan(&id, &org, &repo, &target)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = lockQueue(ctx, tx, org, repo, target); err != nil {
		return err
	}
	var status, pipelineID, actor, run string
	var version int
	var inputs map[string]json.RawMessage
	err = tx.QueryRow(ctx, `UPDATE merge_queue_entries SET checked_at=now() WHERE id=$1 AND `+activeQueue+` AND checked_at<now()-interval '3 seconds' RETURNING status,pipeline_id,version,actor_id,inputs,coalesce(run_id::text,'')`, id).Scan(&status, &pipelineID, &version, &actor, &inputs, &run)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if pending, err := headHasPromotion(ctx, tx, org, repo, target, git); err != nil {
		// Keep this entry's polling delay so other trains can make progress.
		return errors.Join(err, tx.Commit(ctx))
	} else if pending {
		return tx.Commit(ctx)
	}
	var rules []githttp.RefRule
	var defaultBranch string
	var methods githttp.MergeMethods
	if err := tx.QueryRow(ctx, `SELECT ref_rules,default_branch,allow_merge_commit,allow_squash_merge,allow_rebase_merge
		FROM delivery_repositories WHERE organization_id=$1 AND slug=$2`, org, repo).
		Scan(&rules, &defaultBranch, &methods.AllowMergeCommit, &methods.AllowSquashMerge, &methods.AllowRebaseMerge); err != nil {
		return err
	}
	strategy, err := githttp.QueueMergeStrategy(rules, target, defaultBranch)
	if err != nil || target != defaultBranch || methods.CheckBranch(strategy, rules, target, defaultBranch) != nil {
		return tx.Commit(ctx)
	}

	if status != "queued" {
		var runStatus, base, runStrategy string
		if err = tx.QueryRow(ctx, `SELECT status,integration->'target'->>'sha',integration->>'strategy' FROM pipeline_runs WHERE id=$1`, run).Scan(&runStatus, &base, &runStrategy); err != nil {
			return err
		}
		switch runStatus {
		case "failed", "timed_out", "cancelled":
			err = removeQueueEntry(ctx, tx, org, repo, target, id, "failed", "scheduler")
		default:
			head, gitErr := git.ResolveRevision(ctx, org, repo, "refs/heads/"+target)
			if gitErr != nil {
				return tx.Commit(ctx)
			}
			if head.CommitSHA != base || runStrategy != strategy {
				err = cancelTrainRuns(ctx, tx, org, repo, target, 0, "scheduler")
				if err == nil {
					err = invalidateTrain(ctx, tx, org, repo, target, 0, "scheduler")
				}
			} else if runStatus == "succeeded" && status != "ready" {
				_, err = tx.Exec(ctx, `UPDATE merge_queue_entries SET status='ready' WHERE id=$1`, id)
				if err == nil {
					err = queueEvent(ctx, tx, id, "scheduler")
				}
			}
		}
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	rows, err := tx.Query(ctx, `SELECT source_ref,source_sha FROM merge_queue_entries WHERE organization_id=$1 AND repository=$2 AND target=$3 AND id<=$4 AND `+activeQueue+` ORDER BY id`, org, repo, target, id)
	if err != nil {
		return err
	}
	pinned, err := pgx.CollectRows(rows, pgx.RowToStructByPos[delivery.PinnedRef])
	if err != nil {
		return err
	}
	sources := make([]string, len(pinned))
	for i, source := range pinned {
		sources[i] = source.SHA
	}
	candidate, err := git.PrepareCandidate(ctx, org, repo, delivery.MergeRequest{Target: target, Sources: sources, Strategy: strategy})
	if err != nil {
		return tx.Commit(ctx)
	}
	if candidate.Status != "clean" {
		// A conflict is attributable only to the entry at the reported index.
		if candidate.ConflictAt != nil && *candidate.ConflictAt == len(sources)-1 {
			err = removeQueueEntry(ctx, tx, org, repo, target, id, "failed", "scheduler")
		}
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	// Preparation uses pinned commits while promotion verifies the recorded branch names.
	candidate.Sources = pinned
	r, err := createRunTx(ctx, tx, org, pipelineID, version, actor, inputs, nil, &execution.Integration{Repository: repo, Strategy: strategy, MergePreview: candidate, QueueEntry: id}, nil)
	if errors.Is(err, execution.ErrQuota) || errors.Is(err, execution.ErrRepositoryActionsDisabled) {
		return tx.Commit(ctx)
	}
	if errors.Is(err, pipeline.ErrConflict) || errors.Is(err, execution.ErrInputs) || errors.Is(err, execution.ErrTriggerDenied) {
		err = removeQueueEntry(ctx, tx, org, repo, target, id, "failed", "scheduler")
	} else if err == nil {
		err = attachTrainRun(ctx, tx, id, r)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
