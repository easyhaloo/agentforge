CREATE TABLE IF NOT EXISTS oidc_auth_transactions (
    state_hash TEXT PRIMARY KEY,
    nonce_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oidc_auth_transactions_expiry_idx
    ON oidc_auth_transactions (expires_at);
