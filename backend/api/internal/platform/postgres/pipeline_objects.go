package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/easyhaloo/agentforge/backend/api/internal/artifact"
	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/easyhaloo/agentforge/backend/api/internal/pipeline"
	"github.com/jackc/pgx/v5"
)

// RecordTaskOutput is called inside FinishTask after its lease-fenced update. The
// transaction publishes object references and the step outcome together. A bucket
// lifecycle rule collects unreferenced PUTs if the database transaction rolls back.
func (s *Store) RecordTaskOutput(ctx context.Context, tx pgx.Tx, t execution.Task, worker, outcome, output string, suppressOutput bool) error {
	if suppressOutput {
		output = ""
	}
	if s.objects == nil && output == "" {
		return nil
	}
	days, err := s.pipelineRetentionDays(ctx, tx, t.RunID)
	if err != nil {
		return err
	}
	if s.objects == nil {
		_, err := tx.Exec(ctx, `INSERT INTO pipeline_run_events(run_id,kind,step_id,actor,message,expires_at)
			VALUES($1,'log',$2,$3,$4,now()+make_interval(days=>NULLIF($5,0)))`, t.RunID, t.StepID, worker, output, days)
		return err
	}
	if len(output) > 16384 {
		return errors.New("step log exceeds 16 KiB")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	p, err := taskProvenance(ctx, tx, t, worker)
	if err != nil {
		return err
	}
	if output != "" {
		if err := s.saveObject(ctx, tx, p, days, "log", "stdout.txt", []byte(output)); err != nil {
			return err
		}
		if err := runEvent(ctx, tx, t.RunID, "log_stored", t.StepID, worker); err != nil {
			return err
		}
	}
	result, _ := json.Marshal(struct {
		Outcome string `json:"outcome"`
	}{outcome})
	return s.saveObject(ctx, tx, p, days, "artifact", "result.json", result)
}

// Use the shortest applicable policy when a workflow checks another repository.
func (s *Store) pipelineRetentionDays(ctx context.Context, tx pgx.Tx, runID string) (int, error) {
	var days int
	err := tx.QueryRow(ctx, `SELECT COALESCE(min(NULLIF(repo.actions_retention_days,0)),0)
		FROM (SELECT organization_id, repository, `+runRepository+` AS target FROM pipeline_runs WHERE id=$1) run
		JOIN delivery_repositories repo ON repo.organization_id=run.organization_id AND repo.slug IN (run.repository,run.target)`, runID).Scan(&days)
	if s.objects != nil && (days == 0 || days > s.objects.RetentionDays) {
		days = s.objects.RetentionDays
	}
	return days, err
}

func taskProvenance(ctx context.Context, tx pgx.Tx, t execution.Task, worker string) (artifact.Provenance, error) {
	p := artifact.Provenance{Run: t.RunID, Step: t.StepID, Attempt: t.Attempt, Worker: worker}
	err := tx.QueryRow(ctx, `SELECT r.organization_id,r.pipeline_id,r.version,v.checksum,COALESCE(r.integration->>'candidateSHA',r.webhook->>'sha',r.trigger_source->>'sha','') FROM pipeline_runs r JOIN pipeline_versions v ON (v.organization_id,v.pipeline_id,v.number)=(r.organization_id,r.pipeline_id,r.version) WHERE r.id=$1`, t.RunID).Scan(&p.Organization, &p.Pipeline, &p.Version, &p.WorkflowSHA256, &p.SourceSHA)
	return p, err
}

func (s *Store) saveObject(ctx context.Context, tx pgx.Tx, p artifact.Provenance, days int, kind, name string, b []byte) error {
	p.Kind, p.Name = kind, name
	r := artifact.NewRecord(p, b)
	version, err := s.objects.Put(ctx, r, b)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO pipeline_objects(run_id,step_id,attempt,name,provenance,sha256,size_bytes,bucket,object_version,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+make_interval(days=>$10))`, p.Run, p.Step, p.Attempt, name, p, r.SHA256, r.Size, s.objects.Bucket, version, days)
	return err
}

const objectColumns = `o.id,o.provenance,o.sha256,o.size_bytes,o.created_at,o.expires_at,o.purged_at`

func scanObject(r *artifact.Record) []any {
	return []any{&r.ID, &r.Provenance, &r.SHA256, &r.Size, &r.CreatedAt, &r.ExpiresAt, &r.PurgedAt}
}
func (s *Store) ListPipelineObjects(ctx context.Context, org, run string, after int64) ([]artifact.Record, error) {
	if _, err := s.GetRun(ctx, org, run); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT `+objectColumns+` FROM pipeline_objects o JOIN pipeline_runs r ON r.id=o.run_id WHERE r.organization_id=$1 AND r.id::text=$2 AND o.id>$3 ORDER BY o.id LIMIT 100`, org, run, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []artifact.Record{}
	for rows.Next() {
		var item artifact.Record
		if err := rows.Scan(scanObject(&item)...); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Store) ReadPipelineObject(ctx context.Context, org, run string, id int64) (artifact.Record, []byte, error) {
	var r artifact.Record
	var bucket, version string
	var expired bool
	err := s.pool.QueryRow(ctx, `SELECT `+objectColumns+`,o.bucket,o.object_version,o.expires_at<=clock_timestamp() FROM pipeline_objects o JOIN pipeline_runs r ON r.id=o.run_id WHERE r.organization_id=$1 AND r.id::text=$2 AND o.id=$3`, org, run, id).Scan(append(scanObject(&r), &bucket, &version, &expired)...)
	if errors.Is(err, pgx.ErrNoRows) {
		err = pipeline.ErrMissing
	}
	if err != nil {
		return r, nil, err
	}
	if expired || r.PurgedAt != nil {
		return r, nil, artifact.ErrExpired
	}
	if s.objects == nil || s.objects.Bucket != bucket {
		return r, nil, artifact.ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	b, err := s.objects.Read(ctx, r, version)
	return r, b, err
}

// PurgePipelineLogs deletes a bounded batch of expired inline logs.
func (s *Store) PurgePipelineLogs(ctx context.Context) (int64, error) {
	result, err := s.pool.Exec(ctx, `DELETE FROM pipeline_run_events WHERE seq IN (
		SELECT seq FROM pipeline_run_events WHERE expires_at<=now() ORDER BY expires_at,seq LIMIT 100 FOR UPDATE SKIP LOCKED
	)`)
	return result.RowsAffected(), err
}

// PurgePipelineObject deletes one due payload. On a failed or ambiguous DELETE,
// keep the row pending. Repeating DELETE for the pinned key/version is safe.
func (s *Store) PurgePipelineObject(ctx context.Context) (bool, error) {
	if s.objects == nil {
		return false, artifact.ErrUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var r artifact.Record
	var version string
	err = tx.QueryRow(ctx, `SELECT `+objectColumns+`,o.object_version FROM pipeline_objects o WHERE o.purged_at IS NULL AND o.expires_at<=now() AND o.bucket=$1 ORDER BY o.expires_at,o.id LIMIT 1 FOR UPDATE SKIP LOCKED`, s.objects.Bucket).Scan(append(scanObject(&r), &version)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err = s.objects.Delete(ctx, r, version); err != nil {
		return false, err
	}
	if _, err = tx.Exec(ctx, `UPDATE pipeline_objects SET purged_at=clock_timestamp() WHERE id=$1`, r.ID); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
