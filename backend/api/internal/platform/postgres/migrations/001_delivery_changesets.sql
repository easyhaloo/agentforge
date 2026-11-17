CREATE TABLE IF NOT EXISTS delivery_changesets (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    title TEXT NOT NULL,
    state JSONB NOT NULL,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_changesets_repository_updated_idx
    ON delivery_changesets (repository, updated_at DESC);
