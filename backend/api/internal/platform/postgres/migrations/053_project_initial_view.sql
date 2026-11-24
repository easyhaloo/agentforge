ALTER TABLE organization_projects
    ADD COLUMN layout TEXT NOT NULL DEFAULT 'table' CHECK (layout IN ('table', 'board')),
    ADD COLUMN default_repository TEXT,
    ADD COLUMN created_at TIMESTAMPTZ,
    ADD FOREIGN KEY (organization_id, default_repository)
        REFERENCES delivery_repositories(organization_id, slug) ON DELETE SET NULL (default_repository);

ALTER TABLE organization_projects ALTER COLUMN created_at SET DEFAULT now();
