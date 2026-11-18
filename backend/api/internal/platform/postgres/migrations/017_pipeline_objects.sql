CREATE TABLE pipeline_objects (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id uuid NOT NULL, step_id text NOT NULL, attempt integer NOT NULL CHECK (attempt > 0),
    name text NOT NULL, provenance jsonb NOT NULL, sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 0 AND 8388608),
    bucket text NOT NULL, object_version text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, purged_at timestamptz,
    UNIQUE (run_id,step_id,attempt,name), FOREIGN KEY (run_id,step_id) REFERENCES pipeline_step_runs,
    CHECK (expires_at > created_at AND (purged_at IS NULL OR purged_at >= expires_at))
);
CREATE INDEX pipeline_objects_run_cursor ON pipeline_objects(run_id,id);
CREATE INDEX pipeline_objects_expiry ON pipeline_objects(expires_at,id) WHERE purged_at IS NULL;
CREATE TRIGGER immutable_pipeline_object BEFORE DELETE OR UPDATE OF id,run_id,step_id,attempt,name,provenance,sha256,size_bytes,bucket,object_version,created_at,expires_at ON pipeline_objects
    FOR EACH ROW EXECUTE FUNCTION reject_pipeline_version_change();
CREATE TRIGGER immutable_pipeline_purge BEFORE UPDATE OF purged_at ON pipeline_objects
    FOR EACH ROW WHEN (OLD.purged_at IS NOT NULL) EXECUTE FUNCTION reject_pipeline_version_change();
