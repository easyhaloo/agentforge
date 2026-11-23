ALTER TABLE delivery_repositories
    ADD COLUMN allow_merge_commit boolean NOT NULL DEFAULT true,
    ADD COLUMN allow_squash_merge boolean NOT NULL DEFAULT true,
    ADD COLUMN allow_rebase_merge boolean NOT NULL DEFAULT true,
    ADD CONSTRAINT repository_has_merge_method
        CHECK (allow_merge_commit OR allow_squash_merge OR allow_rebase_merge);
