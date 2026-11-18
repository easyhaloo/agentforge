package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/jackc/pgx/v5"
)

var ErrRunnerDenied = errors.New("runner credential invalid or revoked")

func runnerDigest(token string) ([]byte, error) {
	if len(token) != 64 {
		return nil, ErrRunnerDenied
	}
	b, err := hex.DecodeString(token)
	if err != nil {
		return nil, ErrRunnerDenied
	}
	d := sha256.Sum256(b)
	return d[:], nil
}

// RegisterRunner is an operator operation. A revoked credential can never be reused.
func (s *Store) RegisterRunner(ctx context.Context, org, token string, capabilities []string) (string, error) {
	digest, err := runnerDigest(token)
	if err != nil {
		return "", err
	}
	var id string
	err = s.pool.QueryRow(ctx, `INSERT INTO pipeline_runners(organization_id,token_digest,capabilities) VALUES($1,$2,$3) RETURNING id`, org, digest, capabilities).Scan(&id)
	return id, err
}

// All operations that can add or extend a lease share the same organization lock.
// Claims take it exclusively before counting, renewals share it through commit.
func authorizeLease(ctx context.Context, tx pgx.Tx, t execution.Task) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT w.id FROM pipeline_step_runs t JOIN pipeline_runs r ON r.id=t.run_id
 JOIN organizations o ON o.id=r.organization_id JOIN pipeline_runners w ON w.organization_id=o.id AND w.id::text=t.worker_id
 WHERE t.run_id=$1 AND t.id=$2 AND t.lease_digest=sha256($3::bytea) AND t.attempt=$4
 AND o.status='active' AND w.revoked_at IS NULL AND t.capability=ANY(w.capabilities) FOR SHARE OF o,w`, t.RunID, t.StepID, t.WorkerID, t.Attempt).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", execution.ErrLease
	}
	return id, err
}

func (s *Store) RevokeRunner(ctx context.Context, org, id string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE pipeline_runners SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE organization_id=$1 AND id=$2`, org, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrRunnerDenied
	}
	return err
}

func (s *Store) SetRunnerQuota(ctx context.Context, org string, slots int) error {
	tag, err := s.pool.Exec(ctx, `UPDATE organizations SET runner_slots=$2 WHERE id=$1`, org, slots)
	if err == nil && tag.RowsAffected() == 0 {
		return errors.New("unknown runner organization")
	}
	return err
}
