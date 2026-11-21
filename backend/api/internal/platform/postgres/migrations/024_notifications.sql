-- Migration 024: Notifications and Issue Subscriptions

-- Issue subscriptions: tracks which users want notifications for an issue
CREATE TABLE IF NOT EXISTS issue_subscriptions (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, issue_id, user_id),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS issue_subscriptions_user_idx ON issue_subscriptions (organization_id, user_id);
CREATE INDEX IF NOT EXISTS issue_subscriptions_issue_idx ON issue_subscriptions (organization_id, issue_id);

-- Notifications: user notification inbox
CREATE TABLE IF NOT EXISTS notifications (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('comment', 'mention', 'state_change', 'assigned')),
    reason TEXT NOT NULL CHECK (reason IN ('subscribed', 'mentioned', 'author', 'assigned', 'comment')),
    issue_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    issue_number INTEGER NOT NULL CHECK (issue_number > 0),
    issue_title TEXT NOT NULL,
    comment_id TEXT,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    unread BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues(organization_id, id) ON DELETE CASCADE,
    CHECK (
        (unread = false AND read_at IS NOT NULL) OR
        (unread = true AND read_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (organization_id, user_id, unread, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_issue_idx ON notifications (organization_id, issue_id);
