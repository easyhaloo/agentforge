package postgres

import (
	"context"

	"github.com/easyhaloo/agentforge/backend/api/internal/execution"
	"github.com/jackc/pgx/v5"
)

// Scope runtime values to the pinned run, ordered steps in its job and transitive stage dependencies.
func loadScriptEnv(ctx context.Context, tx pgx.Tx, t *execution.Task) error {
	return tx.QueryRow(ctx, `WITH RECURSIVE current_step AS (
   SELECT t.job_id,t.position,j.stage_id FROM pipeline_step_runs t JOIN pipeline_job_runs j ON (j.run_id,j.id)=(t.run_id,t.job_id) WHERE t.run_id=$1 AND t.id=$2
 ), ancestors(id) AS (
   SELECT unnest(s.dependencies) FROM pipeline_stage_runs s JOIN current_step c ON c.stage_id=s.id WHERE s.run_id=$1
   UNION SELECT unnest(s.dependencies) FROM pipeline_stage_runs s JOIN ancestors a ON a.id=s.id WHERE s.run_id=$1
 ), params AS (
   SELECT inputs.key,inputs.value FROM pipeline_runs r JOIN pipeline_versions v ON (v.organization_id,v.pipeline_id,v.number)=(r.organization_id,r.pipeline_id,r.version),
     LATERAL jsonb_each(r.inputs) inputs, LATERAL json_array_elements(NULLIF(v.definition->>'parameters','null')::json) p
   WHERE r.id=$1 AND p->>'name'=inputs.key AND p->>'type'<>'secretRef'
 ), env AS (
   SELECT 'AF_PARAMS_JSON' AS key, COALESCE(jsonb_object_agg(key,value),'{}')::text AS value FROM params
   UNION ALL SELECT 'AF_PARAM_'||key,value #>> '{}' FROM params WHERE key !~ '-'
   UNION ALL SELECT 'AF_VAR_'||e.key,e.value FROM current_step c,pipeline_step_runs t
     JOIN pipeline_job_runs j ON (j.run_id,j.id)=(t.run_id,t.job_id),LATERAL jsonb_each_text(t.exports) e
   WHERE t.run_id=$1 AND t.status='succeeded' AND ((t.job_id=c.job_id AND t.position<c.position) OR j.stage_id IN (SELECT id FROM ancestors))
 ) SELECT jsonb_object_agg(key,value) FROM env`, t.RunID, t.StepID).Scan(&t.Env)
}
