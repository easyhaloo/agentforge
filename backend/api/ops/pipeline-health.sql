-- Run through psql with a read-only monitoring account. Output is one JSON sample.
-- A non-zero exit can feed an existing alert scheduler (alert details precede the psql error).
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH active AS (
    SELECT count(*) FILTER (WHERE status='running') AS running,
           count(*) FILTER (WHERE status='queued') AS queued,
           coalesce(max(extract(epoch FROM now()-created_at)) FILTER (WHERE status='queued'),0)::bigint AS oldest_queued_seconds
    FROM pipeline_runs WHERE status IN ('running','queued')
), leases AS (
    SELECT count(DISTINCT worker_id) FILTER (WHERE lease_until>now()) AS busy_workers,
           count(*) FILTER (WHERE lease_until<=now()) AS expired_leases
    FROM pipeline_step_runs WHERE status='leased'
), finished AS (
    SELECT DISTINCT ON (r.id) r.id,r.status,extract(epoch FROM e.created_at-r.created_at) AS duration
    FROM pipeline_run_events e JOIN pipeline_runs r ON r.id=e.run_id AND r.status=e.kind
    WHERE e.created_at>=now()-interval '1 hour' AND e.step_id IS NULL
      AND r.status IN ('succeeded','failed','cancelled','timed_out')
    ORDER BY r.id,e.seq DESC
), summary AS (
    SELECT count(*) AS completed_last_hour,
           count(*) FILTER (WHERE status IN ('failed','timed_out')) AS unsuccessful_last_hour,
           coalesce(round(avg(duration)),0) AS mean_duration_seconds FROM finished
), train AS (
    SELECT count(*) AS rebuilds_last_hour FROM merge_queue_events
    WHERE status='rebuild' AND created_at>=now()-interval '1 hour'
)
SELECT (to_jsonb(active)||to_jsonb(leases)||to_jsonb(summary)||to_jsonb(train)) AS sample,
       oldest_queued_seconds>300 OR expired_leases>0 OR
         (completed_last_hour>=10 AND unsuccessful_last_hour*2>completed_last_hour) AS alert
FROM active,leases,summary,train \gset
COMMIT;
\echo :sample
\if :alert
  \echo ALERT - inspect waiting runs, expired leases and terminal events
  -- An explicit SQL error makes psql exit 3 with ON_ERROR_STOP on PostgreSQL 17.
  DO $$ BEGIN RAISE EXCEPTION 'pipeline health threshold exceeded'; END $$;
\endif
