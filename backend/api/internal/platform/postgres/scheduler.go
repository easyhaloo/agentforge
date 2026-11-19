package postgres

import (
	"context"
	"crypto/rand"
	"errors"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

// All lifecycle changes lock the run before its tasks, including cancellation and expiry.
func runEvent(ctx context.Context, tx pgx.Tx, run, kind, step, actor string) error {
	_, err := tx.Exec(ctx, `INSERT INTO pipeline_run_events(run_id,kind,step_id,actor) VALUES($1,$2,NULLIF($3,''),$4)`, run, kind, step, actor)
	return err
}
func terminateRun(ctx context.Context, tx pgx.Tx, run, status, actor string) error {
	if _, err := tx.Exec(ctx, `UPDATE pipeline_runs SET status=$2 WHERE id=$1`, run, status); err != nil {
		return err
	}
	remaining := "cancelled"
	if status == "timed_out" {
		remaining = status
	}
	if _, err := tx.Exec(ctx, `UPDATE pipeline_step_runs SET status=$2,worker_id=NULL,lease_until=NULL,lease_digest=NULL WHERE run_id=$1 AND status IN ('queued','leased','waiting')`, run, remaining); err != nil {
		return err
	}
	return runEvent(ctx, tx, run, status, "", actor)
}

const runnableTasks = ` FROM pipeline_step_runs t JOIN pipeline_job_runs j ON (j.run_id,j.id)=(t.run_id,t.job_id) JOIN pipeline_stage_runs s ON (s.run_id,s.id)=(j.run_id,j.stage_id)
 WHERE t.run_id=r.id AND t.capability=ANY($2) AND (t.status='queued' OR (t.status='leased' AND t.lease_until<=statement_timestamp()))
 AND NOT EXISTS (SELECT FROM pipeline_step_runs p WHERE p.run_id=t.run_id AND p.job_id=t.job_id AND p.position<t.position AND p.status<>'succeeded')
 AND NOT EXISTS (SELECT FROM pipeline_job_runs pj JOIN pipeline_step_runs ps ON (ps.run_id,ps.job_id)=(pj.run_id,pj.id) WHERE pj.run_id=t.run_id AND pj.stage_id=ANY(s.dependencies) AND ps.status<>'succeeded')`

func (s *Store) ClaimTask(ctx context.Context, token string) (*execution.Task, error) {
	digest, err := runnerDigest(token)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var worker, org string
	var caps []string
	var slots int
	err = tx.QueryRow(ctx, `SELECT w.id,o.id,w.capabilities,o.runner_slots FROM pipeline_runners w JOIN organizations o ON o.id=w.organization_id
 WHERE w.token_digest=$1 AND w.revoked_at IS NULL AND o.status='active' FOR NO KEY UPDATE OF o FOR SHARE OF w`, digest).Scan(&worker, &org, &caps, &slots)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRunnerDenied
	}
	if err != nil {
		return nil, err
	}
	var capacity bool
	err = tx.QueryRow(ctx, `SELECT count(*)<$2 AND count(*) FILTER (WHERE t.worker_id=$3)=0
 FROM pipeline_runs r JOIN pipeline_step_runs t ON t.run_id=r.id
 WHERE r.organization_id=$1 AND r.status='running' AND r.deadline>statement_timestamp()
 AND t.status='leased' AND t.lease_until>statement_timestamp()`, org, slots, worker).Scan(&capacity)
	if err != nil {
		return nil, err
	}
	var task execution.Task
	var expired bool
	err = tx.QueryRow(ctx, `SELECT r.id,r.organization_id,r.pipeline_id,r.deadline,r.deadline<=statement_timestamp(),r.integration FROM pipeline_runs r WHERE r.organization_id=$1 AND r.status IN ('queued','running') AND (r.deadline<=statement_timestamp() OR $3 AND EXISTS(SELECT 1`+runnableTasks+`)) ORDER BY r.created_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`, org, caps, capacity).Scan(&task.RunID, &task.OrganizationID, &task.PipelineID, &task.Deadline, &expired, &task.Integration)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if expired {
		if err = terminateRun(ctx, tx, task.RunID, "timed_out", worker); err != nil {
			return nil, err
		}
		return nil, tx.Commit(ctx)
	}
	err = tx.QueryRow(ctx, `SELECT t.id,t.capability,t.attempt,t.secret_refs FROM pipeline_runs r CROSS JOIN LATERAL (SELECT t.id,t.capability,t.attempt,t.secret_refs`+runnableTasks+` ORDER BY t.job_id,t.position LIMIT 1)t WHERE r.id=$1`, task.RunID, caps).Scan(&task.StepID, &task.Capability, &task.Attempt, &task.SecretRefs)
	if err != nil {
		return nil, err
	}
	if task.Attempt >= 3 {
		if err = terminateRun(ctx, tx, task.RunID, "failed", worker); err != nil {
			return nil, err
		}
		return nil, tx.Commit(ctx)
	}
	task.Attempt++
	// Pass only this attempt's receipt to the task. Store the public runner ID for audit.
	task.WorkerID = rand.Text()
	_, err = tx.Exec(ctx, `UPDATE pipeline_step_runs SET status='leased',worker_id=$3,attempt=$4,lease_digest=sha256($5::bytea),lease_until=clock_timestamp()+interval '30 seconds' WHERE run_id=$1 AND id=$2`, task.RunID, task.StepID, worker, task.Attempt, task.WorkerID)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `UPDATE pipeline_runs SET status='running' WHERE id=$1`, task.RunID); err != nil {
		return nil, err
	}
	if err = runEvent(ctx, tx, task.RunID, "claimed", task.StepID, worker); err != nil {
		return nil, err
	}
	if len(task.SecretRefs) > 0 {
		if err = runEvent(ctx, tx, task.RunID, "secret_refs_requested", task.StepID, worker); err != nil {
			return nil, err
		}
	}
	return &task, tx.Commit(ctx)
}

const leasePredicate = `run_id=$1 AND id=$2 AND lease_digest=sha256($3::bytea) AND attempt=$4 AND status='leased' AND lease_until>clock_timestamp()`

func (s *Store) Heartbeat(ctx context.Context, t execution.Task) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = authorizeLease(ctx, tx, t); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE pipeline_step_runs SET lease_until=clock_timestamp()+interval '30 seconds' WHERE `+leasePredicate+` AND EXISTS(SELECT FROM pipeline_runs WHERE id=$1 AND deadline>clock_timestamp())`, t.RunID, t.StepID, t.WorkerID, t.Attempt)
	if err == nil && tag.RowsAffected() == 0 {
		return execution.ErrLease
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func finishStep(ctx context.Context, tx pgx.Tx, run, step, outcome, actor string) error {
	if err := runEvent(ctx, tx, run, outcome, step, actor); err != nil {
		return err
	}
	if outcome == "failed" || outcome == "timed_out" {
		return terminateRun(ctx, tx, run, outcome, actor)
	}
	tag, err := tx.Exec(ctx, `UPDATE pipeline_runs SET status='succeeded' WHERE id=$1 AND NOT EXISTS(SELECT FROM pipeline_step_runs WHERE run_id=$1 AND status<>'succeeded')`, run)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		return runEvent(ctx, tx, run, "succeeded", "", actor)
	}
	return nil
}
func (s *Store) FinishTask(ctx context.Context, t execution.Task, outcome, output string) error {
	if outcome != "succeeded" && outcome != "failed" && outcome != "timed_out" && !(outcome == "waiting" && t.Capability == pipeline.Approval) {
		return errors.New("invalid task outcome")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	worker, err := authorizeLease(ctx, tx, t)
	if err != nil {
		return err
	}
	var active bool
	if err = tx.QueryRow(ctx, `SELECT status='running' AND deadline>clock_timestamp() FROM pipeline_runs WHERE id=$1 FOR UPDATE`, t.RunID).Scan(&active); err != nil {
		return err
	}
	if !active {
		return execution.ErrLease
	}
	var suppressOutput bool
	err = tx.QueryRow(ctx, `UPDATE pipeline_step_runs SET status=$5,worker_id=NULL,lease_until=NULL,lease_digest=NULL WHERE `+leasePredicate+` AND (($5='waiting') = (capability=$6)) RETURNING secret_refs <> '{}'::jsonb`, t.RunID, t.StepID, t.WorkerID, t.Attempt, outcome, pipeline.Approval).Scan(&suppressOutput)
	if errors.Is(err, pgx.ErrNoRows) {
		return execution.ErrLease
	}
	if err != nil {
		return err
	}
	if err = s.RecordTaskOutput(ctx, tx, t, worker, outcome, output, suppressOutput); err != nil {
		return err
	}
	if err = finishStep(ctx, tx, t.RunID, t.StepID, outcome, worker); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) DecideRun(ctx context.Context, org, id, step, actor, outcome string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var active bool
	err = tx.QueryRow(ctx, `SELECT status IN ('queued','running') AND deadline>now() FROM pipeline_runs WHERE organization_id=$1 AND id::text=$2 FOR UPDATE`, org, id).Scan(&active)
	if errors.Is(err, pgx.ErrNoRows) {
		return pipeline.ErrMissing
	}
	if err != nil {
		return err
	}
	if !active {
		return pipeline.ErrConflict
	}
	if outcome == "cancelled" {
		err = terminateRun(ctx, tx, id, outcome, actor)
	} else {
		if outcome != "failed" && outcome != "succeeded" {
			return errors.New("invalid approval decision")
		}
		tag, e := tx.Exec(ctx, `UPDATE pipeline_step_runs SET status=$3 WHERE run_id=$1 AND id=$2 AND status='waiting' AND capability=$4`, id, step, outcome, pipeline.Approval)
		if e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			return pipeline.ErrConflict
		}
		err = finishStep(ctx, tx, id, step, outcome, actor)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
