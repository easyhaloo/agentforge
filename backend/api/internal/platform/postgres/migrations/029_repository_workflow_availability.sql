ALTER TABLE pipelines
    ADD COLUMN disabled boolean NOT NULL DEFAULT false,
    ADD CHECK (NOT disabled OR repository IS NOT NULL);

CREATE OR REPLACE FUNCTION capture_pipeline_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_revision jsonb := NEW.state->'revisions'->-1;
BEGIN
    IF active_revision->>'id' IS NULL OR coalesce(active_revision->>'commit_sha','') !~ '^([0-9a-f]{40}|[0-9a-f]{64})$' OR active_revision->>'commit_sha' ~ '^0+$' OR (TG_OP='UPDATE' AND OLD.state->'revisions'->-1->>'id'=active_revision->>'id') THEN RETURN NEW; END IF;
    INSERT INTO pipeline_trigger_events(binding_id,source)
        SELECT b.id,jsonb_build_object('kind','changeset_revision','bindingId',b.id,'repository',NEW.repository,
               'changesetId',NEW.id,'revisionId',active_revision->>'id','sha',active_revision->>'commit_sha')
        FROM pipeline_trigger_bindings b JOIN pipelines p ON (p.organization_id,p.id)=(b.organization_id,b.pipeline_id)
        WHERE b.enabled AND NOT p.disabled AND p.status<>'archived' AND b.organization_id=NEW.organization_id AND b.repository=NEW.repository
        ON CONFLICT DO NOTHING;
    RETURN NEW;
END $$;
