CREATE TABLE git_http_credentials (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    FOREIGN KEY (organization_id, repository) REFERENCES delivery_repositories(organization_id, slug) ON DELETE CASCADE
);
