-- Organization lifecycle: suspension, scheduled deletion, slug history,
-- and organization-level audit events.
ALTER TABLE organizations
    DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE organizations
    ADD CONSTRAINT organizations_status_check
    CHECK (status IN ('active', 'suspended', 'pending_deletion'));

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspended_reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Retired slugs redirect for ORG_DELETION_GRACE-like window (30 days) and
-- cannot be claimed by other organizations while reserved.
CREATE TABLE IF NOT EXISTS organization_slug_history (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    retired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS organization_slug_history_slug_expires_idx
    ON organization_slug_history (slug, expires_at);

-- Organization-level lifecycle audit, kept separate from the membership
-- audit table (SPEC section 1 allows either; we chose a dedicated table and
-- merge both at query time for the audit page).
CREATE TABLE IF NOT EXISTS organization_audit_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN (
        'organization.created', 'organization.renamed', 'organization.slug_changed',
        'organization.ownership_transferred', 'organization.suspended',
        'organization.resumed', 'organization.deletion_scheduled',
        'organization.deletion_cancelled')),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_audit_events_org_created_idx
    ON organization_audit_events (organization_id, created_at DESC, id DESC);
