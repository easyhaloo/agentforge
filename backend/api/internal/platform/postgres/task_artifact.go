package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/artifact"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

// PublishTaskArtifact accepts one binary from the trusted runner host per live
// attempt. Read stdin before taking locks so a slow producer cannot block a run.
func (s *Store) PublishTaskArtifact(ctx context.Context, t execution.Task, expected string, input io.Reader) error {
	if s.objects == nil {
		return artifact.ErrUnavailable
	}
	if len(expected) != sha256.Size*2 {
		return artifact.ErrIntegrity
	}
	data, err := io.ReadAll(io.LimitReader(input, artifact.MaxBytes+1))
	if err != nil {
		return err
	}
	if len(data) > artifact.MaxBytes {
		return errors.New("artifact exceeds 8 MiB")
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != expected {
		return artifact.ErrIntegrity
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	worker, err := authorizeLease(ctx, tx, t)
	if err != nil {
		return err
	}
	// Match the scheduler's run-before-step lock order. Check the clock again
	// after remote I/O, before making the manifest visible.
	var deadline time.Time
	err = tx.QueryRow(ctx, `SELECT deadline FROM pipeline_runs WHERE id=$1 AND status='running' AND deadline>clock_timestamp() FOR UPDATE`, t.RunID).Scan(&deadline)
	if errors.Is(err, pgx.ErrNoRows) {
		return execution.ErrLease
	}
	if err != nil {
		return err
	}
	var allowed bool
	err = tx.QueryRow(ctx, `SELECT secret_refs='{}'::jsonb FROM pipeline_step_runs WHERE `+leasePredicate+` FOR UPDATE`, t.RunID, t.StepID, t.WorkerID, t.Attempt).Scan(&allowed)
	if errors.Is(err, pgx.ErrNoRows) {
		return execution.ErrLease
	}
	if err != nil {
		return err
	}
	if !allowed {
		return errors.New("binary artifact suppressed for secret-bearing attempt")
	}
	const name = "artifact.bin"
	var digest string
	err = tx.QueryRow(ctx, `SELECT sha256 FROM pipeline_objects WHERE run_id=$1 AND step_id=$2 AND attempt=$3 AND name=$4`, t.RunID, t.StepID, t.Attempt, name).Scan(&digest)
	switch {
	case err == nil:
		if digest != expected {
			return pipeline.ErrConflict
		}
		return nil
	case !errors.Is(err, pgx.ErrNoRows):
		return err
	}
	p, err := taskProvenance(ctx, tx, t, worker)
	if err != nil {
		return err
	}
	if err = s.saveObject(ctx, tx, p, "artifact", name, data); err != nil {
		return err
	}
	var live bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT FROM pipeline_step_runs WHERE `+leasePredicate+` AND $5::timestamptz>clock_timestamp())`, t.RunID, t.StepID, t.WorkerID, t.Attempt, deadline).Scan(&live)
	if err != nil {
		return err
	}
	if !live {
		return execution.ErrLease
	}
	return tx.Commit(ctx)
}
