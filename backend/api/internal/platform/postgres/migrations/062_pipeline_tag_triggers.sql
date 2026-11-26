-- Tag trigger bindings pin a glob over the tag name; tag events deduplicate per binding, ref and SHA.
ALTER TABLE pipeline_trigger_bindings ADD COLUMN tag_pattern text;
ALTER TABLE pipeline_trigger_bindings DROP CONSTRAINT pipeline_trigger_bindings_check;
ALTER TABLE pipeline_trigger_bindings ADD CHECK (
    (repository IS NOT NULL AND every_seconds IS NULL AND next_due IS NULL AND tag_pattern IS NULL) OR
    (repository IS NULL AND every_seconds IS NOT NULL AND every_seconds >= 60 AND next_due IS NOT NULL AND isfinite(next_due) AND tag_pattern IS NULL) OR
    (repository IS NOT NULL AND every_seconds IS NULL AND next_due IS NULL AND tag_pattern IS NOT NULL AND
     tag_pattern <> '' AND octet_length(tag_pattern) <= 128 AND tag_pattern !~ '[/\\]' AND tag_pattern !~ '[[:cntrl:]]'));
CREATE INDEX pipeline_trigger_tag ON pipeline_trigger_bindings(organization_id,repository) WHERE enabled AND tag_pattern IS NOT NULL;
CREATE UNIQUE INDEX pipeline_trigger_tag_push ON pipeline_trigger_events(binding_id,(source->>'ref'),(source->>'sha')) WHERE source->>'kind'='tag';
-- One enabled tag rule per workflow; the dispatcher enforces the same rule for duplicates
-- created before this index (EnableWorkflowTrigger answers 409 with pipeline.ErrConflict).
CREATE UNIQUE INDEX pipeline_trigger_tag_binding ON pipeline_trigger_bindings(pipeline_id) WHERE enabled AND tag_pattern IS NOT NULL;
-- Skipped marks a durable tag event whose binding pattern no longer matches at dispatch time.
ALTER TABLE pipeline_trigger_events DROP CONSTRAINT pipeline_trigger_events_outcome_check;
ALTER TABLE pipeline_trigger_events ADD CHECK (outcome IN ('queued','disabled','denied','invalid','skipped'));
-- capture_pipeline_revision must not capture for tag bindings: with 062 a workflow can hold a
-- tag binding whose repository is set, and the revision trigger previously inserted one spurious
-- changeset_revision event per tag binding on every changeset update.
CREATE OR REPLACE FUNCTION capture_pipeline_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_revision jsonb := NEW.state->'revisions'->-1;
BEGIN
    IF active_revision->>'id' IS NULL OR coalesce(active_revision->>'commit_sha','') !~ '^([0-9a-f]{40}|[0-9a-f]{64})$' OR active_revision->>'commit_sha' ~ '^0+$' OR (TG_OP='UPDATE' AND OLD.state->'revisions'->-1->>'id'=active_revision->>'id') THEN RETURN NEW; END IF;
    INSERT INTO pipeline_trigger_events(binding_id,source)
        SELECT b.id,jsonb_build_object('kind','changeset_revision','bindingId',b.id,'repository',NEW.repository,
               'changesetId',NEW.id,'revisionId',active_revision->>'id','sha',active_revision->>'commit_sha','baseSha',active_revision->>'base_sha')
        FROM pipeline_trigger_bindings b JOIN pipelines p ON (p.organization_id,p.id)=(b.organization_id,b.pipeline_id)
        JOIN delivery_repositories r ON (r.organization_id,r.slug)=(b.organization_id,b.repository)
        WHERE b.enabled AND NOT p.disabled AND NOT r.actions_disabled AND p.status<>'archived'
            AND b.organization_id=NEW.organization_id AND b.repository=NEW.repository
            AND b.tag_pattern IS NULL
        ON CONFLICT DO NOTHING;
    RETURN NEW;
END $$;
