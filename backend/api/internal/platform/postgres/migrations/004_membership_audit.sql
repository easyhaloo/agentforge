ALTER TABLE organization_memberships
    DROP CONSTRAINT IF EXISTS organization_memberships_status_check;

ALTER TABLE organization_memberships
    ADD CONSTRAINT organization_memberships_status_check
    CHECK (status IN ('active', 'invited', 'suspended', 'removed'));

CREATE TABLE IF NOT EXISTS organization_membership_audit (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    target_user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN ('role_changed', 'suspended', 'reactivated', 'removed')),
    before_role TEXT NOT NULL CHECK (before_role IN ('owner', 'admin', 'member', 'viewer')),
    after_role TEXT CHECK (after_role IN ('owner', 'admin', 'member', 'viewer')),
    before_status TEXT NOT NULL CHECK (before_status IN ('active', 'invited', 'suspended', 'removed')),
    after_status TEXT NOT NULL CHECK (after_status IN ('active', 'invited', 'suspended', 'removed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_membership_audit_org_created_idx
    ON organization_membership_audit (organization_id, created_at DESC, id DESC);
