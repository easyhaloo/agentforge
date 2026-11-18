CREATE TABLE pipeline_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL,
    pipeline_id text NOT NULL, version integer NOT NULL, actor_id text NOT NULL REFERENCES users,
    inputs jsonb NOT NULL, status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','succeeded','failed','cancelled','timed_out')),
    created_at timestamptz NOT NULL DEFAULT now(), deadline timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
    FOREIGN KEY (organization_id,pipeline_id,version) REFERENCES pipeline_versions
);
CREATE INDEX pipeline_runs_active ON pipeline_runs(organization_id) WHERE status IN ('queued','running');
CREATE TABLE pipeline_stage_runs (
    run_id uuid NOT NULL REFERENCES pipeline_runs, id text NOT NULL, dependencies text[] NOT NULL,
    PRIMARY KEY (run_id,id)
);
CREATE TABLE pipeline_job_runs (
    run_id uuid NOT NULL, stage_id text NOT NULL, id text NOT NULL,
    PRIMARY KEY (run_id,id), FOREIGN KEY (run_id,stage_id) REFERENCES pipeline_stage_runs
);
-- Each step is one durable execution task. Its attempt number fences stale workers.
CREATE TABLE pipeline_step_runs (
    run_id uuid NOT NULL, job_id text NOT NULL, id text NOT NULL, position integer NOT NULL,
    capability text NOT NULL, status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','leased','waiting','succeeded','failed','cancelled','timed_out')),
    attempt integer NOT NULL DEFAULT 0, worker_id text, lease_until timestamptz,
    CHECK ((status='leased') = (worker_id IS NOT NULL AND lease_until IS NOT NULL)),
    PRIMARY KEY (run_id,id), UNIQUE(run_id,job_id,position),
    FOREIGN KEY (run_id,job_id) REFERENCES pipeline_job_runs
);
CREATE TABLE pipeline_run_events (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL REFERENCES pipeline_runs,
    created_at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, message text CHECK (octet_length(message)<=16384), step_id text, actor text NOT NULL
);
CREATE INDEX pipeline_run_events_cursor ON pipeline_run_events(run_id,seq);

CREATE TRIGGER immutable_run_snapshot BEFORE UPDATE OF id,organization_id,pipeline_id,version,actor_id,inputs,created_at ON pipeline_runs
    FOR EACH ROW EXECUTE FUNCTION reject_pipeline_version_change();
