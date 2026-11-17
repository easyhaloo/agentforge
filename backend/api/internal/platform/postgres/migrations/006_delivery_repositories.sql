CREATE TABLE IF NOT EXISTS delivery_repositories (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, slug)
);
