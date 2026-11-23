package postgres

import (
	"context"
	"errors"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

// AdvanceTriggers captures one due timer and dispatches one durable event. They use separate
// transactions so admission pressure cannot lose a tick or hold a schedule row lock.
func (s *Store) AdvanceTriggers(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `WITH due AS (
 SELECT b.id,date_bin(make_interval(secs=>every_seconds),now(),next_due) AS slot FROM pipeline_trigger_bindings b
 JOIN pipelines p ON (p.organization_id,p.id)=(b.organization_id,b.pipeline_id)
 WHERE enabled AND NOT p.disabled AND p.status<>'archived' AND next_due<=now()
 AND NOT EXISTS(SELECT FROM pipeline_trigger_events e WHERE e.binding_id=b.id AND e.outcome IS NULL)
 ORDER BY next_due,b.id LIMIT 1 FOR UPDATE OF b SKIP LOCKED
 ), advanced AS (
 UPDATE pipeline_trigger_bindings b SET next_due=due.slot+make_interval(secs=>every_seconds) FROM due WHERE b.id=due.id RETURNING b.id,due.slot
 ) INSERT INTO pipeline_trigger_events(binding_id,source) SELECT id,jsonb_build_object('kind','schedule','bindingId',id,'scheduledAt',slot) FROM advanced`)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var event int64
	var org, id, actor string
	var version int
	var enabled bool
	var source execution.TriggerSource
	err = tx.QueryRow(ctx, `SELECT e.id,b.organization_id,b.pipeline_id,b.version,b.actor_id,b.enabled,e.source FROM pipeline_trigger_events e JOIN pipeline_trigger_bindings b ON b.id=e.binding_id
 WHERE e.outcome IS NULL AND e.available_at<=now() ORDER BY e.available_at,e.id LIMIT 1 FOR UPDATE OF e SKIP LOCKED FOR SHARE OF b SKIP LOCKED`).Scan(&event, &org, &id, &version, &actor, &enabled, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	outcome := "disabled"
	var runID *string
	if enabled {
		run, err := createRunTx(ctx, tx, org, id, version, actor, nil, nil, nil, &source)
		switch {
		case err == nil:
			outcome = "queued"
			runID = &run.ID
		case errors.Is(err, execution.ErrQuota):
			if _, err = tx.Exec(ctx, `UPDATE pipeline_trigger_events SET available_at=now()+interval '5 seconds' WHERE id=$1`, event); err != nil {
				return err
			}
			return tx.Commit(ctx)
		case errors.Is(err, execution.ErrTriggerDenied):
			outcome = "denied"
		case errors.Is(err, execution.ErrInputs), errors.Is(err, pipeline.ErrConflict), errors.Is(err, pipeline.ErrMissing):
			outcome = "invalid"
		default:
			return err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE pipeline_trigger_events SET outcome=$2,run_id=$3 WHERE id=$1`, event, outcome, runID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) WorkflowTriggers(ctx context.Context, org, id string) ([]pipeline.TriggerBinding, error) {
	rows, err := s.pool.Query(ctx, `SELECT b.id, CASE WHEN b.repository IS NULL THEN 'schedule' ELSE 'changeset_revision' END, b.version, COALESCE(b.every_seconds,0)
	FROM pipeline_trigger_bindings b JOIN pipelines p ON (p.organization_id,p.id)=(b.organization_id,b.pipeline_id)
	WHERE b.organization_id=$1 AND b.pipeline_id=$2 AND p.repository IS NOT NULL AND b.enabled ORDER BY b.id`, org, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[pipeline.TriggerBinding])
}

func (s *Store) EnableWorkflowTrigger(ctx context.Context, org, id, actor, kind string, version, everySeconds int) (pipeline.TriggerBinding, error) {
	binding := pipeline.TriggerBinding{Kind: kind, Version: version, EverySeconds: everySeconds}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return binding, err
	}
	defer tx.Rollback(ctx)
	var repository string
	var archived bool
	err = tx.QueryRow(ctx, `SELECT repository,status='archived' FROM pipelines WHERE organization_id=$1 AND id=$2 AND repository IS NOT NULL FOR UPDATE`, org, id).Scan(&repository, &archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return binding, pipeline.ErrMissing
	}
	if err != nil {
		return binding, err
	}
	if archived {
		return binding, pipeline.ErrConflict
	}
	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pipeline_trigger_bindings WHERE organization_id=$1 AND pipeline_id=$2 AND enabled AND (repository IS NULL)=$3)`, org, id, kind == "schedule").Scan(&exists)
	if err != nil {
		return binding, err
	}
	if exists {
		return binding, pipeline.ErrConflict
	}
	if _, err = runDefinition(ctx, tx, org, id, version, nil, false); err != nil {
		return binding, err
	}
	err = tx.QueryRow(ctx, `INSERT INTO pipeline_trigger_bindings(organization_id,pipeline_id,version,actor_id,repository,every_seconds,next_due)
	VALUES($1,$2,$3,$4,CASE WHEN $5=0 THEN $6 END,NULLIF($5,0),CASE WHEN $5>0 THEN now()+make_interval(secs=>$5) END) RETURNING id`,
		org, id, version, actor, everySeconds, repository).Scan(&binding.ID)
	if err != nil {
		return binding, err
	}
	return binding, tx.Commit(ctx)
}

func (s *Store) DisableWorkflowTrigger(ctx context.Context, org, id, binding string) error {
	result, err := s.pool.Exec(ctx, `UPDATE pipeline_trigger_bindings b SET enabled=false FROM pipelines p
	WHERE (p.organization_id,p.id)=(b.organization_id,b.pipeline_id) AND p.repository IS NOT NULL AND b.organization_id=$1 AND b.pipeline_id=$2 AND b.id::text=$3`, org, id, binding)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pipeline.ErrMissing
	}
	return nil
}
