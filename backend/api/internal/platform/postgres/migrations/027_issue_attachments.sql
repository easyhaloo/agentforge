CREATE TABLE issue_attachments (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    repository TEXT NOT NULL,
    uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_id TEXT,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 26214400),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX issue_attachments_expiry_idx ON issue_attachments (expires_at) WHERE issue_id IS NULL;
CREATE INDEX issue_attachments_issue_idx ON issue_attachments (organization_id, issue_id) WHERE issue_id IS NOT NULL;
CREATE INDEX issue_attachments_uploader_idx ON issue_attachments (organization_id, uploader_id) WHERE issue_id IS NULL;
