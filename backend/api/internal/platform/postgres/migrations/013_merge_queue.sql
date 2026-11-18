CREATE TABLE merge_queue_entries (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    organization_id text NOT NULL, repository text NOT NULL, target text NOT NULL,
    pipeline_id text NOT NULL, version integer NOT NULL, actor_id text NOT NULL REFERENCES users,
    source_ref text NOT NULL, source_sha text NOT NULL, inputs jsonb NOT NULL,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','building','ready','failed','cancelled','promoted')),
    run_id uuid REFERENCES pipeline_runs, candidate_sha text NOT NULL DEFAULT '',
    checked_at timestamptz NOT NULL DEFAULT '-infinity',
    FOREIGN KEY (organization_id,repository) REFERENCES delivery_repositories,
    FOREIGN KEY (organization_id,pipeline_id,version) REFERENCES pipeline_versions
);
CREATE UNIQUE INDEX merge_queue_unique_source ON merge_queue_entries(organization_id,repository,target,source_sha)
    WHERE status IN ('queued','building','ready');
CREATE INDEX merge_queue_active ON merge_queue_entries(organization_id,repository,target,id)
    WHERE status IN ('queued','building','ready');
CREATE TABLE merge_queue_events (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, entry_id bigint NOT NULL REFERENCES merge_queue_entries,
    status text NOT NULL, run_id uuid, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
