CREATE TABLE project_updates (
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    status TEXT NOT NULL CHECK (status IN ('on_track', 'at_risk', 'off_track')),
    body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000 AND char_length(body) <= 10000),
    author_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    start_date DATE,
    target_date DATE,
    PRIMARY KEY (organization_id, project_id, id),
    CHECK (start_date <= target_date),
    FOREIGN KEY (organization_id, project_id) REFERENCES organization_projects(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX project_updates_recent_idx ON project_updates (organization_id, project_id, created_at DESC, id DESC);
