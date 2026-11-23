CREATE TABLE organization_projects (
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100 AND name = btrim(name)),
    repository TEXT,
    PRIMARY KEY (organization_id, id),
    FOREIGN KEY (organization_id, repository) REFERENCES delivery_repositories(organization_id, slug) ON DELETE CASCADE
);

CREATE UNIQUE INDEX organization_projects_name ON organization_projects(organization_id, coalesce(repository, ''), lower(name));

CREATE TABLE issue_projects (
    organization_id TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (organization_id, issue_id, project_id),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, project_id) REFERENCES organization_projects(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX issue_projects_project ON issue_projects(organization_id, project_id);
