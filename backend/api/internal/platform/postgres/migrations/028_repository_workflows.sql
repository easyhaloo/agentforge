ALTER TABLE pipelines ADD COLUMN repository text,
    ADD FOREIGN KEY (organization_id,repository) REFERENCES delivery_repositories(organization_id,slug);
CREATE TRIGGER immutable_pipeline_repository BEFORE UPDATE OF repository ON pipelines
    FOR EACH ROW EXECUTE FUNCTION reject_pipeline_version_change();
CREATE INDEX pipelines_repository ON pipelines (organization_id,repository) WHERE repository IS NOT NULL;

ALTER TABLE pipeline_runs ADD COLUMN repository text,
    ADD FOREIGN KEY (organization_id,repository) REFERENCES delivery_repositories(organization_id,slug);
CREATE TRIGGER immutable_run_repository BEFORE UPDATE OF repository ON pipeline_runs
    FOR EACH ROW EXECUTE FUNCTION reject_pipeline_version_change();
CREATE INDEX pipeline_runs_repository_history ON pipeline_runs
    (organization_id, (COALESCE(integration->>'repository',trigger_source->>'repository',repository)), created_at DESC, id DESC);
