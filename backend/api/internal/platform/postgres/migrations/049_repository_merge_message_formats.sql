ALTER TABLE delivery_repositories
    ADD COLUMN merge_commit_message_format text NOT NULL DEFAULT 'default'
        CHECK (merge_commit_message_format IN ('default', 'title', 'description')),
    ADD COLUMN squash_commit_message_format text NOT NULL DEFAULT 'default'
        CHECK (squash_commit_message_format IN ('default', 'title', 'description', 'commits'));
