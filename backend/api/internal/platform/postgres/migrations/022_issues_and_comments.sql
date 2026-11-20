-- Migration 022: Issue Tracking and Comment Threads
-- GitHub-compatible implementation based on research and design document

-- Repository-scoped number counter (shared between issues and changesets)
CREATE TABLE IF NOT EXISTS resource_number_counters (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    repository TEXT NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (organization_id, repository)
);

-- Labels table (repository-scoped, like GitHub)
CREATE TABLE IF NOT EXISTS labels (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    repository TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 100),
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL CHECK (color ~ '^[0-9a-fA-F]{6}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, repository, name)
);

CREATE INDEX IF NOT EXISTS labels_repository_idx ON labels (organization_id, repository);

-- Milestones table (repository-scoped)
CREATE TABLE IF NOT EXISTS milestones (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    repository TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    due_on TIMESTAMPTZ,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    PRIMARY KEY (organization_id, id),
    CHECK (
        (state = 'closed' AND closed_at IS NOT NULL) OR
        (state != 'closed' AND closed_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS milestones_repository_idx ON milestones (organization_id, repository, state);

-- Issues table: GitHub-compatible issue tracking
CREATE TABLE IF NOT EXISTS issues (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    repository TEXT NOT NULL,
    number INTEGER NOT NULL CHECK (number > 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 500),
    body TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    state_reason TEXT CHECK (state_reason IN ('completed', 'not_planned', 'duplicate') OR state_reason IS NULL),
    milestone_id TEXT,
    locked BOOLEAN NOT NULL DEFAULT false,
    comments_count INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    closed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, repository, number),
    FOREIGN KEY (organization_id, milestone_id) REFERENCES milestones(organization_id, id) ON DELETE SET NULL,
    CHECK (
        (state = 'closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND state_reason IS NOT NULL) OR
        (state != 'closed' AND closed_at IS NULL AND closed_by IS NULL AND state_reason IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS issues_repository_number_idx ON issues (organization_id, repository, number DESC);
CREATE INDEX IF NOT EXISTS issues_state_idx ON issues (organization_id, repository, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS issues_created_by_idx ON issues (organization_id, created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS issues_milestone_idx ON issues (organization_id, milestone_id) WHERE milestone_id IS NOT NULL;

-- Issue-Label many-to-many (GitHub pattern)
CREATE TABLE IF NOT EXISTS issue_labels (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, issue_id, label_id),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, label_id) REFERENCES labels(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS issue_labels_label_idx ON issue_labels (organization_id, label_id);

-- Issue-Assignee many-to-many (GitHub supports multiple assignees)
CREATE TABLE IF NOT EXISTS issue_assignees (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, issue_id, user_id),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS issue_assignees_user_idx ON issue_assignees (organization_id, user_id);

-- Issue-Changeset links: optional bidirectional association
CREATE TABLE IF NOT EXISTS issue_changeset_links (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL,
    changeset_id TEXT NOT NULL,
    linked_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, issue_id, changeset_id),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS issue_changeset_links_issue_idx ON issue_changeset_links (organization_id, issue_id);
CREATE INDEX IF NOT EXISTS issue_changeset_links_changeset_idx ON issue_changeset_links (organization_id, changeset_id);

-- Comments table: unified flat comments for Issues and Changesets (GitHub pattern)
CREATE TABLE IF NOT EXISTS comments (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    resource_type TEXT NOT NULL CHECK (resource_type IN ('issue', 'changeset')),
    resource_id TEXT NOT NULL,
    body TEXT NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 65536),
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    minimized BOOLEAN NOT NULL DEFAULT false,
    minimized_reason TEXT CHECK (minimized_reason IN ('spam', 'off-topic', 'outdated', 'resolved') OR minimized_reason IS NULL),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    PRIMARY KEY (organization_id, id),
    CHECK (
        (minimized = true AND minimized_reason IS NOT NULL) OR
        (minimized = false AND minimized_reason IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS comments_resource_idx ON comments (organization_id, resource_type, resource_id, created_at ASC);
CREATE INDEX IF NOT EXISTS comments_author_idx ON comments (organization_id, author_id, created_at DESC);

-- Reactions table: polymorphic reactions on issues and comments (GitHub pattern)
-- Supported emojis: +1, -1, laugh, confused, heart, hooray, rocket, eyes
CREATE TABLE IF NOT EXISTS reactions (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    reactable_type TEXT NOT NULL CHECK (reactable_type IN ('issue', 'comment')),
    reactable_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (content IN ('+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, reactable_type, reactable_id, user_id, content)
);

CREATE INDEX IF NOT EXISTS reactions_reactable_idx ON reactions (organization_id, reactable_type, reactable_id);
CREATE INDEX IF NOT EXISTS reactions_user_idx ON reactions (organization_id, user_id);

-- Issue timeline events: complete audit trail (GitHub pattern)
CREATE TABLE IF NOT EXISTS issue_events (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'created', 'closed', 'reopened',
        'labeled', 'unlabeled',
        'assigned', 'unassigned',
        'milestoned', 'demilestoned',
        'renamed', 'edited',
        'locked', 'unlocked',
        'linked_changeset', 'unlinked_changeset',
        'commented', 'mentioned', 'referenced'
    )),
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS issue_events_issue_idx ON issue_events (organization_id, issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_events_type_idx ON issue_events (organization_id, event_type, created_at DESC);

-- Changeset timeline events: extend existing changesets with comment support
-- This allows comments on changesets without duplicating the issue_events table
CREATE TABLE IF NOT EXISTS changeset_events (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    changeset_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'commented', 'mentioned', 'referenced',
        'linked_issue', 'unlinked_issue'
    )),
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id)
);

CREATE INDEX IF NOT EXISTS changeset_events_changeset_idx ON changeset_events (organization_id, changeset_id, created_at DESC);
