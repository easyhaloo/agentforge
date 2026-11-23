package postgres

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/githttp"
)

// LockPullRequestBranches serializes PR creation and reopening with automatic
// deletion from branch validation through persistence, including linked issues.
func (s *Store) LockPullRequestBranches(ctx context.Context, org, repo string) (func(), error) {
	return s.LockChangeset(ctx, org, "pr-branches:"+repo)
}

// CleanupMergedPullRequestBranches runs after the merge is committed. A skipped
// or failed Git deletion must not turn a committed merge into an API failure.
func (s *Store) CleanupMergedPullRequestBranches(ctx context.Context, org, repo string, changesets []delivery.Changeset, git *delivery.LocalGitProvider) {
	if len(changesets) == 0 || git == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 4*time.Second)
	defer cancel()
	if err := s.cleanupMergedBranches(ctx, org, repo, changesets, git); err != nil {
		slog.Warn("automatic pull request branch cleanup failed", "organization", org, "repository", repo, "error", err)
	}
}

func (s *Store) cleanupMergedBranches(ctx context.Context, org, repo string, changesets []delivery.Changeset, git *delivery.LocalGitProvider) error {
	release, err := s.LockPullRequestBranches(ctx, org, repo)
	if err != nil {
		return err
	}
	defer release()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var enabled bool
	var policy githttp.PushPolicy
	if err := tx.QueryRow(ctx, `SELECT delete_merged_branches,default_branch,protected_refs,ref_rules FROM delivery_repositories
		WHERE organization_id=$1 AND slug=$2 FOR NO KEY UPDATE`, org, repo).
		Scan(&enabled, &policy.DefaultBranch, &policy.ProtectedRefs, &policy.RefRules); err != nil || !enabled {
		return err
	}
	for _, change := range changesets {
		pr := change.PullRequest
		revision, ok := change.CurrentRevision()
		if pr == nil || !ok || change.Merge == nil || change.Merge.RevisionID != revision.ID ||
			change.Merge.TargetRef != pr.BaseBranch || !policy.AllowsBranchDeletion(pr.SourceBranch) {
			continue
		}
		var inUse bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM delivery_changesets WHERE organization_id=$1 AND repository=$2 AND id<>$3
			AND state->>'merge' IS NULL AND state#>>'{pull_request,closed}'='false'
			AND $4 IN (state#>>'{pull_request,source_branch}',state#>>'{pull_request,base_branch}')
		) OR EXISTS (
			SELECT 1 FROM merge_queue_entries WHERE organization_id=$1 AND repository=$2
			AND `+activeQueue+` AND $4 IN (source_ref,target)
		)`, org, repo, change.ID, pr.SourceBranch).Scan(&inUse); err != nil {
			return err
		}
		if !inUse {
			if err := git.DeleteMergedBranch(ctx, org, repo, pr.SourceBranch, pr.BaseBranch, revision.CommitSHA); err != nil && !errors.Is(err, delivery.ErrWriteConflict) {
				return fmt.Errorf("delete merged branch: %w", err)
			}
		}
	}
	return nil
}
