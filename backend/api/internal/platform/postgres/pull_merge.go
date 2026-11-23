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

func (s *Store) CompletePullMergeIntent(ctx context.Context, org string, stored delivery.StoredChangeset, intent delivery.PullMergeIntent) (delivery.StoredChangeset, error) {
	c := stored.Changeset
	revision, current := c.CurrentRevision()
	if !current || revision.ID != intent.RevisionID {
		return delivery.StoredChangeset{}, delivery.ErrVersionConflict
	}
	if err := c.CompleteMerge(intent.ID, intent.Actor, intent.Candidate.Target.Ref, intent.Candidate.CandidateSHA, intent.CreatedAt); err != nil {
		return delivery.StoredChangeset{}, err
	}
	err := s.pool.QueryRow(ctx, `UPDATE delivery_changesets SET state=$4, version=version+1, updated_at=now(), pull_merge_intent=NULL
		WHERE organization_id=$1 AND id=$2 AND version=$3 AND pull_merge_intent->>'id'=$5
		RETURNING version,updated_at`, org, c.ID, stored.Version, c, intent.ID).Scan(&stored.Version, &stored.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return delivery.StoredChangeset{}, delivery.ErrVersionConflict
	}
	return stored, err
}
