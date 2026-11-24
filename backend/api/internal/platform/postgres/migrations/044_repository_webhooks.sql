CREATE TABLE repository_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    url TEXT NOT NULL CHECK (octet_length(url) <= 2048),
    secret BYTEA NOT NULL CHECK (octet_length(secret) BETWEEN 16 AND 256),
    events TEXT[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 2 AND events <@ ARRAY['issues', 'issue_comment']),
    active BOOLEAN NOT NULL DEFAULT true,
    config_version BIGINT NOT NULL DEFAULT 1,
    FOREIGN KEY (organization_id, repository) REFERENCES delivery_repositories(organization_id, slug) ON DELETE CASCADE
);

CREATE INDEX repository_webhooks_repository_idx ON repository_webhooks (organization_id, repository, id);

CREATE TABLE repository_webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES repository_webhooks(id) ON DELETE CASCADE,
    config_version BIGINT NOT NULL,
    event TEXT NOT NULL CHECK (event IN ('issues', 'issue_comment')),
    resource_id TEXT NOT NULL,
    payload JSONB,
    status TEXT NOT NULL CHECK (status IN ('pending', 'delivering', 'succeeded', 'failed')),
    http_status INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    delivered_at TIMESTAMPTZ,
    lease_until TIMESTAMPTZ,
    UNIQUE (webhook_id, event, resource_id)
);

CREATE INDEX repository_webhook_deliveries_history_idx
    ON repository_webhook_deliveries (webhook_id, created_at DESC, id DESC);
CREATE INDEX repository_webhook_deliveries_pending_idx
    ON repository_webhook_deliveries (created_at, id) WHERE status = 'pending';
CREATE INDEX repository_webhook_deliveries_lease_idx
    ON repository_webhook_deliveries (lease_until, id) WHERE status = 'delivering';
