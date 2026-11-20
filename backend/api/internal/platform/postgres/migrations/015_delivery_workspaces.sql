CREATE TABLE IF NOT EXISTS delivery_workspaces (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    repository TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    base_commit_sha TEXT NOT NULL CHECK (base_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
    base_ref TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'closed')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, repository)
        REFERENCES delivery_repositories (organization_id, slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS delivery_workspaces_owner_status_idx
    ON delivery_workspaces (organization_id, owner_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS delivery_workspaces_expiry_idx
    ON delivery_workspaces (expires_at)
    WHERE status = 'active';

CREATE TABLE IF NOT EXISTS delivery_workspace_files (
    organization_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 1024),
    content BYTEA NOT NULL,
    sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    version BIGINT NOT NULL CHECK (version > 0),
    updated_by TEXT NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, workspace_id, path),
    FOREIGN KEY (organization_id, workspace_id)
        REFERENCES delivery_workspaces (organization_id, id) ON DELETE CASCADE
);
