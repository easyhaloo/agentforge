ALTER TABLE organization_projects
    DROP CONSTRAINT organization_projects_layout_check,
    ADD CHECK (layout IN ('table', 'board', 'roadmap')),
    ADD COLUMN description TEXT NOT NULL DEFAULT '',
    ADD COLUMN readme TEXT NOT NULL DEFAULT '',
    ADD COLUMN closed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN views JSONB;

UPDATE organization_projects SET updated_at = coalesce(created_at, updated_at),
    views = jsonb_build_array(jsonb_build_object('id', 'default', 'name', '', 'layout', layout,
        'filter', '', 'sort', 'manual', 'group', CASE WHEN layout = 'board' THEN 'status' ELSE 'none' END));
ALTER TABLE organization_projects ALTER COLUMN views SET NOT NULL;

ALTER TABLE organizations ADD COLUMN last_project_number INTEGER NOT NULL DEFAULT 0;
UPDATE organizations o SET last_project_number = p.last_number
FROM (SELECT organization_id, max(number) AS last_number FROM organization_projects GROUP BY organization_id) p
WHERE p.organization_id = o.id;

CREATE TABLE project_repositories (
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    PRIMARY KEY (organization_id, project_id, repository),
    FOREIGN KEY (organization_id, project_id) REFERENCES organization_projects(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, repository) REFERENCES delivery_repositories(organization_id, slug) ON DELETE CASCADE
);

INSERT INTO project_repositories SELECT organization_id, id, repository
FROM organization_projects WHERE repository IS NOT NULL;

CREATE TABLE project_items (
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    issue_id TEXT,
    pull_request_id TEXT,
    draft_title TEXT,
    status TEXT CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT NOT NULL DEFAULT '' CHECK (priority IN ('', 'p0', 'p1', 'p2')),
    start_date DATE,
    target_date DATE,
    iteration TEXT NOT NULL DEFAULT '',
    archived BOOLEAN NOT NULL DEFAULT false,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, project_id, id),
    UNIQUE (organization_id, issue_id, project_id),
    UNIQUE (organization_id, project_id, pull_request_id),
    CHECK (num_nonnulls(issue_id, pull_request_id, draft_title) = 1),
    CHECK (draft_title IS NULL OR char_length(btrim(draft_title)) BETWEEN 1 AND 500),
    CHECK (start_date <= target_date),
    FOREIGN KEY (organization_id, project_id) REFERENCES organization_projects(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, pull_request_id) REFERENCES delivery_changesets(organization_id, id) ON DELETE CASCADE,
    -- Conversion claims the draft's ID before creating the corresponding Issue link.
    FOREIGN KEY (organization_id, issue_id, project_id) REFERENCES issue_projects(organization_id, issue_id, project_id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

INSERT INTO project_items (organization_id, issue_id, project_id)
SELECT organization_id, issue_id, project_id FROM issue_projects;

CREATE FUNCTION project_item_from_issue_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO project_items (organization_id, issue_id, project_id)
    VALUES (NEW.organization_id, NEW.issue_id, NEW.project_id)
    ON CONFLICT (organization_id, issue_id, project_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER project_item_from_issue_link AFTER INSERT ON issue_projects
FOR EACH ROW EXECUTE FUNCTION project_item_from_issue_link();
