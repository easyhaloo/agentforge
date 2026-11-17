ALTER TABLE organization_membership_audit
    DROP CONSTRAINT IF EXISTS organization_membership_audit_action_check;
ALTER TABLE organization_membership_audit
    ADD CONSTRAINT organization_membership_audit_action_check
    CHECK (action IN ('role_changed', 'suspended', 'reactivated', 'removed', 'invite_accepted'));

CREATE TABLE IF NOT EXISTS organization_invitations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    token_hash TEXT NOT NULL UNIQUE,
    invited_by_user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by_user_id TEXT REFERENCES users(id),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS organization_invitations_org_created_idx
    ON organization_invitations (organization_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS organization_invitations_pending_email_idx
    ON organization_invitations (organization_id, lower(invited_email))
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
