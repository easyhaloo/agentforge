ALTER TABLE pipeline_runs ADD COLUMN integration jsonb;
CREATE TRIGGER immutable_integration BEFORE UPDATE OF integration ON pipeline_runs
    FOR EACH ROW EXECUTE FUNCTION reject_pipeline_version_change();
CREATE TABLE integration_promotions (
    run_id uuid PRIMARY KEY REFERENCES pipeline_runs,
    candidate_sha text NOT NULL, actor_id text NOT NULL REFERENCES users,
    promoted_at timestamptz NOT NULL DEFAULT now()
);
