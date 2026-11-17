ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS csrf_token_hash TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS sessions_active_user_expiry_idx
    ON sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;
