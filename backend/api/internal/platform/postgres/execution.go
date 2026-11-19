package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

const runColumns = `id,pipeline_id,version,actor_id,status,inputs,created_at,deadline,webhook,integration,trigger_source`

func scanRun(row pgx.Row) (execution.Run, error) {
	return scanRunSnapshot(row, false)
}
func scanRunSnapshot(row pgx.Row, withSteps bool) (execution.Run, error) {
	var r execution.Run
	fields := []any{&r.ID, &r.PipelineID, &r.Version, &r.ActorID, &r.Status, &r.Inputs, &r.CreatedAt, &r.Deadline, &r.Webhook, &r.Integration, &r.Trigger}
	if withSteps {
		fields = append(fields, &r.StepStatuses)
	}
	err := row.Scan(fields...)
	if errors.Is(err, pgx.ErrNoRows) {
		err = pipeline.ErrMissing
	}
	return r, err
}
func (s *Store) GetRun(ctx context.Context, org, id string) (execution.Run, error) {
	return scanRunSnapshot(s.pool.QueryRow(ctx, `SELECT `+runColumns+`,
 (SELECT jsonb_object_agg(t.id,t.status) FROM pipeline_step_runs t WHERE t.run_id=r.id)
 FROM pipeline_runs r WHERE organization_id=$1 AND id::text=$2`, org, id), true)
}
func (s *Store) CreateRun(ctx context.Context, org, id string, number int, actor string, inputs map[string]json.RawMessage) (execution.Run, error) {
	return s.createRun(ctx, org, id, number, actor, inputs, nil, nil)
}
func (s *Store) TriggerRun(ctx context.Context, org, id string, number int, actor string, hook execution.Webhook) (execution.Run, error) {
	return s.createRun(ctx, org, id, number, actor, nil, &hook, nil)
}
func (s *Store) CreateIntegrationRun(ctx context.Context, org, id string, number int, actor string, inputs map[string]json.RawMessage, integration execution.Integration) (execution.Run, error) {
	return s.createRun(ctx, org, id, number, actor, inputs, nil, &integration)
}
func (s *Store) createRun(ctx context.Context, org, id string, number int, actor string, inputs map[string]json.RawMessage, hook *execution.Webhook, integration *execution.Integration) (execution.Run, error) {
	var empty execution.Run
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx)
	run, err := createRunTx(ctx, tx, org, id, number, actor, inputs, hook, integration, nil)
	if err != nil {
		return empty, err
	}
	return run, tx.Commit(ctx)
}
func createRunTx(ctx context.Context, tx pgx.Tx, org, id string, number int, actor string, inputs map[string]json.RawMessage, hook *execution.Webhook, integration *execution.Integration, source *execution.TriggerSource) (execution.Run, error) {
	var empty execution.Run
	var err error
	// Serialize admission within the tenant so concurrent requests cannot exceed its quota.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(9071,hashtext($1))`, org); err != nil {
		return empty, err
	}
	if hook != nil || source != nil || (integration != nil && integration.QueueEntry != 0) {
		var allowed bool
		err = tx.QueryRow(ctx, `SELECT true FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active' AND o.status='active' AND m.role IN ('member','owner','admin') FOR SHARE OF m,o`, org, actor).Scan(&allowed)
		if errors.Is(err, pgx.ErrNoRows) {
			return empty, execution.ErrTriggerDenied
		}
		if err != nil {
			return empty, err
		}
	}
	if hook != nil {
		prior, err := scanRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM pipeline_runs WHERE organization_id=$1 AND webhook->>'hook'=$2 AND (webhook->>'delivery'=$3 OR webhook->>'digest'=$4)`, org, hook.Hook, hook.Delivery, hook.Digest))
		if err == nil {
			if prior.Webhook.Digest != hook.Digest {
				return empty, pipeline.ErrConflict
			}
			return prior, nil
		}
		if !errors.Is(err, pipeline.ErrMissing) {
			return empty, err
		}
	}
	def, err := runDefinition(ctx, tx, org, id, number, inputs, integration != nil)
	if err != nil {
		return empty, err
	}
	snapshot := map[string]json.RawMessage{}
	for _, p := range def.Parameters {
		value := p.Default
		if v, ok := inputs[p.Name]; ok {
			value = v
		}
		if value != nil {
			snapshot[p.Name] = value
		}
	}
	var active int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM pipeline_runs WHERE organization_id=$1 AND status IN ('queued','running')`, org).Scan(&active); err != nil {
		return empty, err
	}
	if active >= 16 {
		return empty, execution.ErrQuota
	}
	run, err := scanRun(tx.QueryRow(ctx, `INSERT INTO pipeline_runs(organization_id,pipeline_id,version,actor_id,inputs,webhook,integration,trigger_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING `+runColumns, org, id, number, actor, snapshot, hook, integration, source))
	if err != nil {
		return empty, err
	}
	stages, jobs, steps := [][]any{}, [][]any{}, [][]any{}
	for i, stage := range def.Stages {
		deps := stage.DependsOn
		if deps == nil {
			deps = []string{}
			if i > 0 {
				deps = append(deps, def.Stages[i-1].ID)
			}
		}
		stages = append(stages, []any{run.ID, stage.ID, deps})
		for _, job := range stage.Jobs {
			jobs = append(jobs, []any{run.ID, stage.ID, job.ID})
			for i, step := range job.Steps {
				refs := map[string]string{}
				for _, name := range step.SecretParams {
					if raw := snapshot[name]; raw != nil {
						var ref string
						if err := json.Unmarshal(raw, &ref); err != nil {
							return empty, err
						}
						refs[name] = ref
					}
				}
				steps = append(steps, []any{run.ID, job.ID, step.ID, i, step.Uses, refs})
			}
		}
	}
	for _, group := range []struct {
		table   string
		columns []string
		rows    [][]any
	}{{"pipeline_stage_runs", []string{"run_id", "id", "dependencies"}, stages}, {"pipeline_job_runs", []string{"run_id", "stage_id", "id"}, jobs}, {"pipeline_step_runs", []string{"run_id", "job_id", "id", "position", "capability", "secret_refs"}, steps}} {
		if _, err = tx.CopyFrom(ctx, pgx.Identifier{group.table}, group.columns, pgx.CopyFromRows(group.rows)); err != nil {
			return empty, err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO pipeline_run_events(run_id,kind,actor) VALUES($1,'queued',$2)`, run.ID, actor); err != nil {
		return empty, err
	}
	return run, nil
}

func (s *Store) Events(ctx context.Context, org, id string, after int64) ([]execution.Event, error) {
	if _, err := s.GetRun(ctx, org, id); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT e.seq,e.created_at,e.message,e.kind,e.step_id,e.actor FROM pipeline_run_events e JOIN pipeline_runs r ON r.id=e.run_id WHERE r.organization_id=$1 AND r.id::text=$2 AND e.seq>$3 ORDER BY e.seq LIMIT 128`, org, id, after)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[execution.Event])
}

func runDefinition(ctx context.Context, tx pgx.Tx, org, id string, number int, inputs map[string]json.RawMessage, needsCheck bool) (pipeline.Definition, error) {
	var def pipeline.Definition
	var archived bool
	err := tx.QueryRow(ctx, `SELECT v.definition,p.status='archived' FROM pipelines p JOIN pipeline_versions v ON (v.organization_id,v.pipeline_id)=(p.organization_id,p.id) WHERE p.organization_id=$1 AND p.id=$2 AND v.number=$3 FOR SHARE OF p`, org, id, number).Scan(&def, &archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return def, pipeline.ErrMissing
	}
	if err != nil {
		return def, err
	}
	if archived {
		return def, pipeline.ErrConflict
	}
	if err = def.ValidateInputs(inputs); err != nil {
		return def, fmt.Errorf("%w: %s", execution.ErrInputs, err)
	}
	if needsCheck {
		checked := false
		for _, stage := range def.Stages {
			for _, job := range stage.Jobs {
				for _, step := range job.Steps {
					checked = checked || step.Uses == pipeline.ContainerCheck
				}
			}
		}
		if !checked {
			return def, fmt.Errorf("%w: integration workflow requires a container check", execution.ErrInputs)
		}
	}
	return def, nil
}
