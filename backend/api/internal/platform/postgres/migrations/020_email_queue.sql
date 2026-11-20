CREATE TABLE IF NOT EXISTS email_queue (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    is_html BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    CHECK (status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS email_queue_status_retry_idx
    ON email_queue (status, next_retry_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS email_queue_organization_created_idx
    ON email_queue (organization_id, created_at DESC);
