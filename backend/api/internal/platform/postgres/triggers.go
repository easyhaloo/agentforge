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
 SELECT id,date_bin(make_interval(secs=>every_seconds),now(),next_due) AS slot FROM pipeline_trigger_bindings b
 WHERE enabled AND next_due<=now() AND NOT EXISTS(SELECT FROM pipeline_trigger_events e WHERE e.binding_id=b.id AND e.outcome IS NULL)
 ORDER BY next_due,id LIMIT 1 FOR UPDATE SKIP LOCKED
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
