-- Bindings are operator-managed. Replace a binding to change its authority or destination.
CREATE TABLE pipeline_trigger_bindings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id text NOT NULL, pipeline_id text NOT NULL, version integer NOT NULL,
    actor_id text NOT NULL REFERENCES users, enabled boolean NOT NULL DEFAULT true,
    repository text, every_seconds integer, next_due timestamptz,
    CHECK ((repository IS NOT NULL AND every_seconds IS NULL AND next_due IS NULL) OR
           (repository IS NULL AND every_seconds IS NOT NULL AND every_seconds >= 60 AND next_due IS NOT NULL AND isfinite(next_due))),
    FOREIGN KEY (organization_id,pipeline_id,version) REFERENCES pipeline_versions,
    FOREIGN KEY (organization_id,repository) REFERENCES delivery_repositories(organization_id,slug)
);
CREATE TRIGGER immutable_trigger_binding BEFORE UPDATE OF id,organization_id,pipeline_id,version,actor_id,repository,every_seconds ON pipeline_trigger_bindings
    FOR EACH ROW EXECUTE FUNCTION reject_pipeline_version_change();
CREATE INDEX pipeline_trigger_due ON pipeline_trigger_bindings(next_due) WHERE enabled AND next_due IS NOT NULL;
CREATE INDEX pipeline_trigger_repo ON pipeline_trigger_bindings(organization_id,repository) WHERE enabled AND repository IS NOT NULL;
CREATE TABLE pipeline_trigger_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    binding_id uuid NOT NULL REFERENCES pipeline_trigger_bindings,
    source jsonb NOT NULL, available_at timestamptz NOT NULL DEFAULT now(),
    outcome text CHECK (outcome IN ('queued','disabled','denied','invalid')),
    run_id uuid UNIQUE REFERENCES pipeline_runs,
    CHECK ((outcome IS NOT DISTINCT FROM 'queued') = (run_id IS NOT NULL))
);
CREATE INDEX pipeline_trigger_pending ON pipeline_trigger_events(available_at,id) WHERE outcome IS NULL;
CREATE UNIQUE INDEX pipeline_trigger_revision ON pipeline_trigger_events(binding_id,(source->>'changesetId'),(source->>'revisionId')) WHERE source->>'kind'='changeset_revision';
CREATE FUNCTION capture_pipeline_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision jsonb := NEW.state->'revisions'->-1;
BEGIN
    IF revision->>'id' IS NULL OR coalesce(revision->>'commit_sha','') !~ '^([0-9a-f]{40}|[0-9a-f]{64})$' OR revision->>'commit_sha' ~ '^0+$' OR (TG_OP='UPDATE' AND OLD.state->'revisions'->-1->>'id'=revision->>'id') THEN RETURN NEW; END IF;
    INSERT INTO pipeline_trigger_events(binding_id,source)
        SELECT id,jsonb_build_object('kind','changeset_revision','bindingId',id,'repository',NEW.repository,
               'changesetId',NEW.id,'revisionId',revision->>'id','sha',revision->>'commit_sha')
        FROM pipeline_trigger_bindings WHERE enabled AND organization_id=NEW.organization_id AND repository=NEW.repository
        ON CONFLICT DO NOTHING;
    RETURN NEW;
END $$;
CREATE TRIGGER capture_pipeline_revision AFTER INSERT OR UPDATE OF state ON delivery_changesets
    FOR EACH ROW EXECUTE FUNCTION capture_pipeline_revision();
ALTER TABLE pipeline_runs ADD COLUMN trigger_source jsonb;
CREATE TRIGGER immutable_trigger_source BEFORE UPDATE OF trigger_source ON pipeline_runs FOR EACH ROW EXECUTE FUNCTION reject_pipeline_version_change();
