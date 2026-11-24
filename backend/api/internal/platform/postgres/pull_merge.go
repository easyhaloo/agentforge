package postgres

import (
	"context"
	"errors"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/jackc/pgx/v5"
)

func (s *Store) PullMergeIntent(ctx context.Context, org string, id delivery.ID) (*delivery.PullMergeIntent, error) {
	var intent *delivery.PullMergeIntent
	err := s.pool.QueryRow(ctx, `SELECT pull_merge_intent FROM delivery_changesets WHERE organization_id=$1 AND id=$2`, org, id).Scan(&intent)
	return intent, err
}

func (s *Store) WritePullMergeIntent(ctx context.Context, org string, id delivery.ID, version int64, intent *delivery.PullMergeIntent) error {
	var saved delivery.ID
	err := s.pool.QueryRow(ctx, `UPDATE delivery_changesets SET pull_merge_intent=$4 WHERE organization_id=$1 AND id=$2 AND version=$3 RETURNING id`, org, id, version, intent).Scan(&saved)
	if errors.Is(err, pgx.ErrNoRows) {
		return delivery.ErrVersionConflict
	}
	return err
}

func (s *Store) CompletePullMergeIntent(ctx context.Context, org string, stored delivery.StoredChangeset, intent delivery.PullMergeIntent, git *delivery.LocalGitProvider) (delivery.StoredChangeset, error) {
	c := stored.Changeset
	revision, current := c.CurrentRevision()
	if !current || revision.ID != intent.RevisionID {
		return delivery.StoredChangeset{}, delivery.ErrVersionConflict
	}
	if err := c.CompleteMerge(intent.ID, intent.Actor, intent.Candidate.Target.Ref, intent.Candidate.CandidateSHA, intent.CreatedAt); err != nil {
		return delivery.StoredChangeset{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return delivery.StoredChangeset{}, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `UPDATE delivery_changesets SET state=$4, version=version+1, updated_at=now(), pull_merge_intent=NULL
		WHERE organization_id=$1 AND id=$2 AND version=$3 AND pull_merge_intent->>'id'=$5
		RETURNING version,updated_at`, org, c.ID, stored.Version, c, intent.ID).Scan(&stored.Version, &stored.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return delivery.StoredChangeset{}, delivery.ErrVersionConflict
	}
	if err != nil {
		return delivery.StoredChangeset{}, err
	}
	if err := closeMergedPullIssues(ctx, tx, org, c, intent.Candidate.Target.Ref, intent.Actor); err != nil {
		return delivery.StoredChangeset{}, err
	}
	if err := closeMergedCommitIssues(ctx, tx, git, org, c.Repository, intent.Candidate.Target.Ref, intent.Candidate.Target.SHA, intent.Candidate.CandidateSHA, intent.Actor); err != nil {
		return delivery.StoredChangeset{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return delivery.StoredChangeset{}, err
	}
	return stored, nil
}

// CompleteLocalMerge is the persistence path for a registered checkout merged with MergeRevision.
func (s *Store) CompleteLocalMerge(ctx context.Context, org string, stored delivery.StoredChangeset, baseSHA string, git *delivery.LocalGitProvider) (delivery.StoredChangeset, error) {
	c := stored.Changeset
	if c == nil || c.Merge == nil {
		return delivery.StoredChangeset{}, delivery.ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return delivery.StoredChangeset{}, err
	}
	defer tx.Rollback(ctx)
	updated, err := updateChangeset(ctx, tx, org, c, stored.Version)
	if err != nil {
		return delivery.StoredChangeset{}, err
	}
	if err := closeMergedPullIssues(ctx, tx, org, c, c.Merge.TargetRef, c.Merge.Actor); err != nil {
		return delivery.StoredChangeset{}, err
	}
	if err := closeMergedCommitIssues(ctx, tx, git, org, c.Repository, c.Merge.TargetRef, baseSHA, c.Merge.CommitSHA, c.Merge.Actor); err != nil {
		return delivery.StoredChangeset{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return delivery.StoredChangeset{}, err
	}
	return updated, nil
}
