ALTER TABLE project_items ADD COLUMN done_since TIMESTAMPTZ;
-- Start the clock at migration for existing Done items because their current
-- uninterrupted period cannot always be reconstructed from legacy data.
UPDATE project_items SET done_since = statement_timestamp() WHERE status = 'done' AND NOT archived;

CREATE INDEX project_items_done_since ON project_items (organization_id, project_id, done_since)
    WHERE done_since IS NOT NULL;

CREATE FUNCTION track_project_item_done_since() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM 'done' OR NEW.archived THEN
        NEW.done_since := NULL;
    ELSIF TG_OP = 'INSERT' THEN
        NEW.done_since := clock_timestamp();
    ELSE
        NEW.done_since := coalesce(OLD.done_since, clock_timestamp());
    END IF;
    RETURN NEW;
END;
$$;

-- The existing default-status trigger runs first (triggers run in name order).
CREATE TRIGGER track_project_item_done_since BEFORE INSERT OR UPDATE OF status, archived ON project_items
FOR EACH ROW EXECUTE FUNCTION track_project_item_done_since();

CREATE TABLE project_workflow_runs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    rule TEXT NOT NULL CHECK (rule IN ('issue_closed', 'pull_request_closed', 'pull_request_merged', 'auto_archive', 'auto_add')),
    item_count INTEGER NOT NULL CHECK (item_count > 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (organization_id, project_id) REFERENCES organization_projects(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX project_workflow_runs_recent ON project_workflow_runs (organization_id, project_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION apply_project_source_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    WITH changed AS (
        UPDATE project_items AS item
        SET status = project.workflows->>TG_ARGV[0], version = item.version + 1
        FROM organization_projects AS project
        WHERE item.organization_id = NEW.organization_id
          AND item.organization_id = project.organization_id AND item.project_id = project.id
          AND ((TG_ARGV[0] = 'issue_closed' AND item.issue_id = NEW.id)
               OR (TG_ARGV[0] <> 'issue_closed' AND item.pull_request_id = NEW.id))
          AND NOT project.closed AND NOT item.archived
          AND project.workflows->>TG_ARGV[0] <> ''
          AND item.status IS DISTINCT FROM project.workflows->>TG_ARGV[0]
        RETURNING item.organization_id, item.project_id
    )
    INSERT INTO project_workflow_runs (organization_id, project_id, rule, item_count)
    SELECT organization_id, project_id, TG_ARGV[0], count(*) FROM changed GROUP BY organization_id, project_id;
    RETURN NEW;
END;
$$;

CREATE INDEX organization_projects_auto_add ON organization_projects (organization_id, (workflows #>> '{auto_add,repository}'))
    WHERE NOT closed AND workflows ? 'auto_add';

-- Source events are processed in the same transaction as the actual transition.
-- Uniqueness on the source link makes simultaneous manual and automatic adds idempotent.
CREATE FUNCTION auto_add_project_source(source_org TEXT, source_repo TEXT, source_kind TEXT, source_id TEXT,
    added_label TEXT DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
    WITH matching_projects AS MATERIALIZED (
        SELECT p.organization_id, p.id FROM organization_projects p
        WHERE p.organization_id = source_org AND NOT p.closed AND p.workflows ? 'auto_add'
        AND p.workflows #>> '{auto_add,repository}' = source_repo
        AND p.workflows #>> '{auto_add,kind}' = source_kind
        AND (p.repository IS NULL OR p.repository = source_repo)
        AND EXISTS (SELECT 1 FROM delivery_repositories r
            WHERE (r.organization_id, r.slug) = (source_org, source_repo)
            AND (source_kind <> 'issue' OR NOT r.issues_disabled))
        AND CASE WHEN added_label IS NOT NULL THEN p.workflows #>> '{auto_add,label_id}' = added_label
            ELSE coalesce(p.workflows #>> '{auto_add,label_id}', '') = '' OR EXISTS (
                SELECT 1 FROM issue_labels l WHERE (l.organization_id, l.issue_id) = (source_org, source_id)
                AND l.label_id = p.workflows #>> '{auto_add,label_id}') END
        ORDER BY p.id FOR SHARE OF p
    ), linked_issues AS (
        INSERT INTO issue_projects (organization_id, issue_id, project_id)
        SELECT p.organization_id, source_id, p.id FROM matching_projects p WHERE source_kind = 'issue'
        -- A converted draft already owns this source in its original project.
        AND NOT EXISTS (SELECT 1 FROM project_items i
            WHERE (i.organization_id, i.project_id, i.issue_id) = (p.organization_id, p.id, source_id))
        ON CONFLICT DO NOTHING RETURNING organization_id, project_id
    ), linked_pulls AS (
        INSERT INTO project_items (organization_id, project_id, pull_request_id)
        SELECT organization_id, id, source_id FROM matching_projects WHERE source_kind = 'pull_request'
        ON CONFLICT DO NOTHING RETURNING organization_id, project_id
    )
    INSERT INTO project_workflow_runs (organization_id, project_id, rule, item_count)
    SELECT organization_id, project_id, 'auto_add', 1 FROM linked_issues
    UNION ALL SELECT organization_id, project_id, 'auto_add', 1 FROM linked_pulls;
$$;

CREATE FUNCTION auto_add_project_issue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM auto_add_project_source(NEW.organization_id, NEW.repository, 'issue', NEW.id);
    RETURN NEW;
END;
$$;
CREATE TRIGGER auto_add_project_issue_created AFTER INSERT ON issues
FOR EACH ROW WHEN (NEW.state = 'open') EXECUTE FUNCTION auto_add_project_issue();
CREATE TRIGGER auto_add_project_issue_reopened AFTER UPDATE OF state ON issues
FOR EACH ROW WHEN (OLD.state = 'closed' AND NEW.state = 'open') EXECUTE FUNCTION auto_add_project_issue();

CREATE FUNCTION auto_add_project_labeled_issue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM auto_add_project_source(i.organization_id, i.repository, 'issue', i.id, NEW.label_id)
    FROM issues i JOIN labels l ON (l.organization_id, l.repository, l.id) = (i.organization_id, i.repository, NEW.label_id)
    WHERE (i.organization_id, i.id) = (NEW.organization_id, NEW.issue_id) AND i.state = 'open';
    RETURN NEW;
END;
$$;
CREATE TRIGGER auto_add_project_issue_labeled AFTER INSERT ON issue_labels
FOR EACH ROW EXECUTE FUNCTION auto_add_project_labeled_issue();

CREATE FUNCTION auto_add_project_pull_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM auto_add_project_source(NEW.organization_id, NEW.repository, 'pull_request', NEW.id);
    RETURN NEW;
END;
$$;
CREATE TRIGGER auto_add_project_pull_request_created AFTER INSERT ON delivery_changesets
FOR EACH ROW WHEN (NEW.state #> '{pull_request,closed}' = 'false'::jsonb AND NOT (NEW.state ? 'merge'))
EXECUTE FUNCTION auto_add_project_pull_request();
CREATE TRIGGER auto_add_project_pull_request_opened AFTER UPDATE OF state ON delivery_changesets
FOR EACH ROW WHEN (NEW.state #> '{pull_request,closed}' = 'false'::jsonb AND NOT (NEW.state ? 'merge')
    AND OLD.state #> '{pull_request,closed}' IS DISTINCT FROM 'false'::jsonb)
EXECUTE FUNCTION auto_add_project_pull_request();
