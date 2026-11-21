ALTER TABLE delivery_repositories
    ADD COLUMN visibility TEXT NOT NULL DEFAULT '' CHECK (visibility IN ('', 'public', 'private')),
    ADD COLUMN fork BOOLEAN NOT NULL DEFAULT false;
