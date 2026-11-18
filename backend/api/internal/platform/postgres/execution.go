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

const runColumns = `id,pipeline_id,version,actor_id,status,inputs,created_at,deadline`

func scanRun(row pgx.Row) (execution.Run, error) {
	var r execution.Run
	err := row.Scan(&r.ID, &r.PipelineID, &r.Version, &r.ActorID, &r.Status, &r.Inputs, &r.CreatedAt, &r.Deadline)
	if errors.Is(err, pgx.ErrNoRows) {
		err = pipeline.ErrMissing
	}
	return r, err
}
func (s *Store) GetRun(ctx context.Context, org, id string) (execution.Run, error) {
	return scanRun(s.pool.QueryRow(ctx, `SELECT `+runColumns+` FROM pipeline_runs WHERE organization_id=$1 AND id::text=$2`, org, id))
}
func (s *Store) CreateRun(ctx context.Context, org, id string, number int, actor string, inputs map[string]json.RawMessage) (execution.Run, error) {
	var empty execution.Run
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(ctx)
	// Serialize admission within the tenant so concurrent requests cannot exceed its quota.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(9071,hashtext($1))`, org); err != nil {
		return empty, err
	}
	var def pipeline.Definition
	var archived bool
	err = tx.QueryRow(ctx, `SELECT v.definition,p.status='archived' FROM pipelines p JOIN pipeline_versions v ON (v.organization_id,v.pipeline_id)=(p.organization_id,p.id) WHERE p.organization_id=$1 AND p.id=$2 AND v.number=$3 FOR SHARE OF p`, org, id, number).Scan(&def, &archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return empty, pipeline.ErrMissing
	}
	if err != nil {
		return empty, err
	}
	if archived {
		return empty, pipeline.ErrConflict
	}
	if err = def.ValidateInputs(inputs); err != nil {
		return empty, fmt.Errorf("%w: %s", execution.ErrInputs, err)
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
	run, err := scanRun(tx.QueryRow(ctx, `INSERT INTO pipeline_runs(organization_id,pipeline_id,version,actor_id,inputs) VALUES($1,$2,$3,$4,$5) RETURNING `+runColumns, org, id, number, actor, snapshot))
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
	return run, tx.Commit(ctx)
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
