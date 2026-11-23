CREATE TABLE IF NOT EXISTS issue_commit_links (
    organization_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    commit_sha TEXT NOT NULL CHECK (commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
    subject TEXT NOT NULL,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, repository, issue_id, commit_sha),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, repository) REFERENCES delivery_repositories(organization_id, slug) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS issue_commit_links_by_commit
    ON issue_commit_links (organization_id, repository, commit_sha);
