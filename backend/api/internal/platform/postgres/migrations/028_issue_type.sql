ALTER TABLE issues ADD COLUMN issue_type TEXT NOT NULL DEFAULT ''
    CHECK (issue_type IN ('', 'task', 'bug', 'feature'));
