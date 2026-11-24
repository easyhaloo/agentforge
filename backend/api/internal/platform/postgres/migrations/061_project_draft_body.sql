ALTER TABLE project_items ADD COLUMN draft_body TEXT NOT NULL DEFAULT '',
    ADD CONSTRAINT project_items_draft_body_check CHECK (
        char_length(draft_body) <= 65536 AND (draft_title IS NOT NULL OR draft_body = '')
    );
