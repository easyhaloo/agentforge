CREATE TABLE notification_email_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    address TEXT NOT NULL DEFAULT '',
    participating BOOLEAN NOT NULL DEFAULT false,
    watching BOOLEAN NOT NULL DEFAULT false,
    pending_address TEXT NOT NULL DEFAULT '',
    pending_hash BYTEA,
    requested_at TIMESTAMPTZ
);


CREATE INDEX email_queue_verification_destination ON email_queue (lower(to_address), created_at) WHERE organization_id='';
