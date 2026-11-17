ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing non-null emails were only written from verified OIDC claims.
UPDATE users SET email_verified = TRUE WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_invitations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    token_hash TEXT NOT NULL UNIQUE,
    invited_by_user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by_user_id TEXT REFERENCES users(id),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending_email_idx
    ON organization_invitations (organization_id, lower(email))
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS organization_invitations_expiry_idx
    ON organization_invitations (expires_at)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS organization_membership_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    target_user_id TEXT REFERENCES users(id),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'invitation.created',
        'invitation.accepted',
        'member.role_changed',
        'member.suspended',
        'member.reactivated',
        'member.removed'
    )),
    email TEXT,
    previous_role TEXT,
    new_role TEXT,
    previous_status TEXT,
    new_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_membership_events_timeline_idx
    ON organization_membership_events (organization_id, created_at DESC, id DESC);
