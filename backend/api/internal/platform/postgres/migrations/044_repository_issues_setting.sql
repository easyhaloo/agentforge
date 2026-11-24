ALTER TABLE delivery_repositories ADD COLUMN issues_disabled boolean NOT NULL DEFAULT false;

CREATE VIEW enabled_repository_issues AS
SELECT i.* FROM issues i WHERE NOT EXISTS (
    SELECT 1 FROM delivery_repositories r
    WHERE (r.organization_id, r.slug) = (i.organization_id, i.repository) AND r.issues_disabled
);
