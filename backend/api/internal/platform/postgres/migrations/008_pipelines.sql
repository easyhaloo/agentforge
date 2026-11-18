CREATE TABLE pipelines (
    organization_id text NOT NULL REFERENCES organizations(id), id text NOT NULL,
    name text NOT NULL, status text NOT NULL CHECK (status IN ('draft','published','archived')),
    revision integer NOT NULL DEFAULT 1, version integer NOT NULL DEFAULT 0,
    definition json NOT NULL, PRIMARY KEY (organization_id, id)
);
CREATE TABLE pipeline_versions (
    organization_id text NOT NULL, pipeline_id text NOT NULL, number integer NOT NULL,
    definition json NOT NULL, checksum text NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, pipeline_id, number),
    FOREIGN KEY (organization_id, pipeline_id) REFERENCES pipelines
);
CREATE FUNCTION reject_pipeline_version_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'published pipeline versions are immutable'; END $$;
CREATE TRIGGER immutable_pipeline_version BEFORE UPDATE OR DELETE ON pipeline_versions
    FOR EACH ROW EXECUTE FUNCTION reject_pipeline_version_change();
CREATE TABLE pipeline_audit (
    organization_id text NOT NULL, pipeline_id text NOT NULL, revision integer NOT NULL,
    actor_id text NOT NULL REFERENCES users(id), action text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id, pipeline_id, revision),
    FOREIGN KEY (organization_id, pipeline_id) REFERENCES pipelines
);
