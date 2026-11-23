-- Composite keys make it impossible to link issues from different repositories.
ALTER TABLE issues ADD UNIQUE (organization_id, repository, id);

CREATE TABLE issue_parents (
    organization_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    child_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    PRIMARY KEY (organization_id, repository, child_id),
    FOREIGN KEY (organization_id, repository, child_id) REFERENCES issues (organization_id, repository, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, repository, parent_id) REFERENCES issues (organization_id, repository, id) ON DELETE CASCADE,
    CHECK (child_id <> parent_id)
);

CREATE INDEX issue_parents_children_idx ON issue_parents (organization_id, repository, parent_id);

-- NULL means no artifact link. True means the link claimed a draft; false means the
-- attachment was already bound to the issue body and must survive artifact removal.
ALTER TABLE issue_attachments ADD COLUMN artifact_owns_binding BOOLEAN,
    ADD CHECK (artifact_owns_binding IS NULL OR issue_id IS NOT NULL);

CREATE TABLE issue_content_reports (
    organization_id TEXT NOT NULL,
    id TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    reporter_id TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    -- An empty comment ID targets the issue body. Keep IDs of deleted comments for moderation.
    comment_id TEXT NOT NULL DEFAULT '' CHECK (length(comment_id) <= 128),
    reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'harassment', 'inappropriate', 'other')),
    details TEXT NOT NULL CHECK (length(details) <= 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues (organization_id, id) ON DELETE CASCADE,
    UNIQUE (organization_id, issue_id, reporter_id, comment_id)
);
