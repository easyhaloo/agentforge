package postgres

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

// PromoteIntegration records the exact actor decision, verifies the current Changeset gates,
// and moves the target only while the matching database state is locked.
func (s *Store) PromoteIntegration(ctx context.Context, org, id, actor, sha string, git execution.PromotionProvider) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	receipts, ok := git.(execution.PromotionReceipts)
	if !ok {
		return delivery.ErrProviderUnavailable
	}
	err := s.promoteIntegration(ctx, org, id, actor, sha, git, receipts, true)
	if errors.Is(err, errPromotionIntentRecorded) {
		return s.promoteIntegration(ctx, org, id, actor, sha, git, receipts, false)
	}
	return err
}

var errPromotionIntentRecorded = errors.New("promotion intent recorded")

func (s *Store) promoteIntegration(ctx context.Context, org, id, actor, sha string, git execution.PromotionProvider, receipts execution.PromotionReceipts, canRecordIntent bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	run, err := scanRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM pipeline_runs WHERE organization_id=$1 AND id::text=$2`, org, id))
	if err != nil {
		return err
	}
	candidate := run.Integration
	if candidate == nil || sha != candidate.CandidateSHA || run.Status != "succeeded" {
		return pipeline.ErrConflict
	}
	if err = lockQueue(ctx, tx, org, candidate.Repository, candidate.Target.Ref); err != nil {
		return err
	}
	var rules []githttp.RefRule
	var methods githttp.MergeMethods
	err = tx.QueryRow(ctx, `SELECT d.ref_rules, d.allow_merge_commit, d.allow_squash_merge, d.allow_rebase_merge FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id JOIN delivery_repositories d ON d.organization_id=o.id WHERE o.id=$1 AND o.status='active' AND m.status='active' AND m.user_id=$2 AND m.role IN ('owner','admin') AND d.slug=$3 AND d.default_branch=$4 FOR SHARE OF m,o FOR NO KEY UPDATE OF d`, org, actor, candidate.Repository, candidate.Target.Ref).Scan(&rules, &methods.AllowMergeCommit, &methods.AllowSquashMerge, &methods.AllowRebaseMerge)
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
	recorded, err := receipts.HasPromotion(ctx, org, candidate.Repository, id, sha)
	if err != nil {
		return err
	}
	rewritten := candidate.Strategy == "squash" || candidate.Strategy == "rebase"
	local, localGit := git.(*delivery.LocalGitProvider)
	if rewritten && (!localGit || candidate.QueueEntry == 0 || len(candidate.Sources) != 1) {
		return pipeline.ErrConflict
	}
	var pullRequestRule error
	if !recorded {
		if err := methods.CheckBranch(candidate.Strategy, rules, candidate.Target.Ref, candidate.Target.Ref); err != nil {
			return err
		}
		if candidate.QueueEntry != 0 {
			strategy, err := githttp.QueueMergeStrategy(rules, candidate.Target.Ref, candidate.Target.Ref)
			if err != nil || strategy != candidate.Strategy {
				return pipeline.ErrConflict
			}
		}
		err = githttp.CheckBranchMerge(rules, candidate.Target.Ref, candidate.Target.Ref, false, candidate.QueueEntry != 0)
		if errors.Is(err, githttp.ErrBranchPullRequestRequired) {
			pullRequestRule = err
		} else if err != nil {
			return err
		}
	}
	if !recorded && githttp.LinearHistoryRule(rules, candidate.Target.Ref, candidate.Target.Ref) != "" {
		local, ok := git.(*delivery.LocalGitProvider)
		if !ok {
			return delivery.ErrProviderUnavailable
		}
		if err := local.CheckLinearHistory(ctx, org, candidate.Repository, candidate.Target.SHA, sha); err != nil {
			return err
		}
	}
	var first int64
	var currentRun string
	err = tx.QueryRow(ctx, `SELECT id,coalesce(run_id::text,'') FROM merge_queue_entries WHERE organization_id=$1 AND repository=$2 AND target=$3 AND `+activeQueue+` ORDER BY id LIMIT 1`, org, candidate.Repository, candidate.Target.Ref).Scan(&first, &currentRun)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if (!recorded || candidate.QueueEntry != 0) && (first != candidate.QueueEntry || (first != 0 && currentRun != id)) {
		return pipeline.ErrConflict
	}
	// The intent survives a failed final COMMIT. Only its owner may perform the Git
	// update, and the target lock prevents replacing the intent once a receipt exists.
	var intentActor string
	err = tx.QueryRow(ctx, `SELECT actor FROM pipeline_run_events WHERE run_id=$1 AND kind='promotion_requested' ORDER BY seq DESC LIMIT 1`, id).Scan(&intentActor)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if recorded {
		if intentActor == "" {
			return pipeline.ErrConflict
		}
		if err := runEvent(ctx, tx, id, "promotion_reconciled", "", actor); err != nil {
			return err
		}
		actor = intentActor
	} else if intentActor != actor {
		if !canRecordIntent {
			return pipeline.ErrConflict
		}
		if err := runEvent(ctx, tx, id, "promotion_requested", "", actor); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return errPromotionIntentRecorded
	}
	var commits []string
	if rewritten {
		// Rewritten commits have new IDs. The verified pull request is identified
		// by its original source branch and SHA, both pinned at queue admission.
		commits = []string{candidate.Sources[0].SHA}
	} else {
		commits, err = git.CandidateCommits(ctx, org, candidate.Repository, candidate.MergePreview)
		if err != nil {
			return err
		}
	}
	// ponytail: a table lock prevents revisions from entering the candidate set during promotion.
	// Replace with a per-repository write lock on all Changeset mutation paths if contention matters.
	if _, err = tx.Exec(ctx, `LOCK TABLE delivery_changesets IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	if !recorded && githttp.BranchRequiresConversationResolution(rules, candidate.Target.Ref, candidate.Target.Ref) {
		if len(candidate.Sources) == 0 {
			return githttp.ErrBranchPullRequestRequired
		}
		for _, source := range candidate.Sources {
			pull, _, err := lockCandidatePullRequest(ctx, tx, org, candidate.Repository, candidate.Target.Ref, source)
			if err != nil {
				return err
			}
			if pull.HasUnresolvedPRConversations() {
				return githttp.ErrUnresolvedConversations
			}
		}
	}
	rows, err := tx.Query(ctx, `SELECT state FROM delivery_changesets WHERE organization_id=$1 AND repository=$2 AND EXISTS (SELECT FROM jsonb_array_elements(COALESCE(NULLIF(state->'revisions','null'::jsonb),'[]'::jsonb)) r WHERE r->>'commit_sha'=ANY($3::text[]))`, org, candidate.Repository, commits)
	if err != nil {
		return err
	}
	changesets, err := pgx.CollectRows(rows, pgx.RowTo[delivery.Changeset])
	if err != nil {
		return err
	}
	if rewritten {
		source := candidate.Sources[0]
		changesets = slices.DeleteFunc(changesets, func(c delivery.Changeset) bool {
			pull := c.PullRequest
			return pull == nil || pull.Closed || pull.BaseBranch != candidate.Target.Ref || pull.SourceBranch != source.Ref
		})
		if len(changesets) != 1 {
			return fmt.Errorf("%w: cannot verify pull request coverage for %s", githttp.ErrBranchPullRequestRequired, source.Ref)
		}
	}
	if pullRequestRule != nil {
		resolver, ok := git.(delivery.GitProvider)
		if !ok || len(candidate.Sources) == 0 {
			return pullRequestRule
		}
		for _, source := range candidate.Sources {
			qualified := slices.ContainsFunc(changesets, func(c delivery.Changeset) bool {
				pull := c.PullRequest
				if pull == nil || pull.BaseBranch != candidate.Target.Ref || pull.SourceBranch != source.Ref {
					return false
				}
				revision, ok := c.CurrentRevision()
				return ok && revision.CommitSHA == source.SHA && c.ValidateMerge() == nil
			})
			if !qualified {
				return fmt.Errorf("%w: cannot verify pull request coverage for %s", pullRequestRule, source.Ref)
			}
			live, err := resolver.ResolveRevision(ctx, org, candidate.Repository, "refs/heads/"+source.Ref)
			if err != nil || live.CommitSHA != source.SHA {
				return fmt.Errorf("%w: source branch %s moved", pullRequestRule, source.Ref)
			}
		}
	}
	checks := githttp.BranchRequiredWorkflows(rules, candidate.Target.Ref, candidate.Target.Ref)
	for i := range changesets {
		c := &changesets[i]
		revision, ok := c.CurrentRevision()
		if !ok || !slices.Contains(commits, revision.CommitSHA) {
			return pipeline.ErrConflict
		}
		if !recorded {
			if err = local.CheckRequiredWorkflowBase(ctx, org, c.Repository, candidate.Target.SHA, revision.CommitSHA, checks); err != nil {
				return err
			}
			if err = checkRequiredWorkflows(ctx, tx, org, c, revision, candidate.Target.SHA, checks); err != nil {
				return err
			}
		}
		evaluation, ok := c.LatestEvaluation(revision.ID)
		if !ok || evaluation.BaseSHA != candidate.Target.SHA {
			return pipeline.ErrConflict
		}
		if err = c.CompleteMerge(delivery.ID(id), actor, candidate.Target.Ref, sha, time.Now().UTC()); err != nil {
			return pipeline.ErrConflict
		}
		result, err := tx.Exec(ctx, `UPDATE delivery_changesets SET state=$3,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND pull_merge_intent IS NULL`, org, string(c.ID), c)
		if err != nil {
			return err
		}
		if result.RowsAffected() != 1 {
			return pipeline.ErrConflict
		}
		if err := closeMergedPullIssues(ctx, tx, org, c, candidate.Target.Ref, actor); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO integration_promotions(run_id,candidate_sha,actor_id) VALUES($1,$2,$3)`, id, sha, actor); err != nil {
		return err
	}
	if err = runEvent(ctx, tx, id, "promoted", "", actor); err != nil {
		return err
	}
	if candidate.QueueEntry != 0 {
		if err = removeQueueEntry(ctx, tx, org, candidate.Repository, candidate.Target.Ref, candidate.QueueEntry, "promoted", actor); err != nil {
			return err
		}
	}
	if !recorded {
		promote := git.PromoteCandidate
		if rewritten {
			promote = local.PromoteRewrittenCandidate
		}
		if err = promote(ctx, org, candidate.Repository, id, candidate.MergePreview); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if localGit {
		s.CleanupMergedPullRequestBranches(ctx, org, candidate.Repository, changesets, local)
	}
	return nil
}
