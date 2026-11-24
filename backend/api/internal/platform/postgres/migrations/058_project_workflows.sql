-- Existing projects retain their manual status behavior. New projects enable the built-in rules.
ALTER TABLE organization_projects ADD COLUMN workflows JSONB NOT NULL DEFAULT
    '{"item_added":"todo","issue_closed":"","pull_request_closed":"","pull_request_merged":""}';
ALTER TABLE organization_projects ALTER COLUMN workflows SET DEFAULT
    '{"item_added":"todo","issue_closed":"done","pull_request_closed":"done","pull_request_merged":"done"}';

CREATE INDEX project_items_pull_request_source ON project_items (organization_id, pull_request_id)
    WHERE pull_request_id IS NOT NULL;

CREATE FUNCTION set_new_project_item_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    SELECT workflows->>'item_added' INTO NEW.status FROM organization_projects
    WHERE organization_id = NEW.organization_id AND id = NEW.project_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_new_project_item_status BEFORE INSERT ON project_items
FOR EACH ROW EXECUTE FUNCTION set_new_project_item_status();

-- Run in the source transaction, so a rollback cannot leave a project status change behind.
-- Each trigger fires only on a real transition. It never writes to the source record.
CREATE FUNCTION apply_project_source_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE project_items AS item
    SET status = project.workflows->>TG_ARGV[0], version = item.version + 1
    FROM organization_projects AS project
    WHERE item.organization_id = NEW.organization_id
      AND item.organization_id = project.organization_id AND item.project_id = project.id
      AND ((TG_ARGV[0] = 'issue_closed' AND item.issue_id = NEW.id)
           OR (TG_ARGV[0] <> 'issue_closed' AND item.pull_request_id = NEW.id))
      AND NOT project.closed AND NOT item.archived
      AND project.workflows->>TG_ARGV[0] <> ''
      AND item.status <> project.workflows->>TG_ARGV[0];
    RETURN NEW;
END;
$$;

CREATE TRIGGER apply_project_issue_closed AFTER UPDATE OF state ON issues
FOR EACH ROW WHEN (OLD.state = 'open' AND NEW.state = 'closed')
EXECUTE FUNCTION apply_project_source_workflow('issue_closed');

CREATE TRIGGER apply_project_pull_request_closed AFTER UPDATE OF state ON delivery_changesets
FOR EACH ROW WHEN (OLD.state #> '{pull_request,closed}' = 'false'::jsonb
    AND NEW.state #> '{pull_request,closed}' = 'true'::jsonb AND NOT (NEW.state ? 'merge'))
EXECUTE FUNCTION apply_project_source_workflow('pull_request_closed');

CREATE TRIGGER apply_project_pull_request_merged AFTER UPDATE OF state ON delivery_changesets
FOR EACH ROW WHEN (NEW.state ? 'pull_request' AND NOT (OLD.state ? 'merge') AND NEW.state ? 'merge')
EXECUTE FUNCTION apply_project_source_workflow('pull_request_merged');
