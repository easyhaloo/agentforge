ALTER TABLE delivery_repositories ADD COLUMN push_ref_limit integer NOT NULL DEFAULT 0
    CHECK (push_ref_limit = 0 OR push_ref_limit BETWEEN 2 AND 128);
