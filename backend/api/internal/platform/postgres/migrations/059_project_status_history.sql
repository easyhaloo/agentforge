ALTER TABLE organization_projects ADD COLUMN history_since TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE project_status_history (
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    previous_status TEXT,
    next_status TEXT,
    FOREIGN KEY (organization_id, project_id) REFERENCES organization_projects(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX project_status_history_timeline ON project_status_history (organization_id, project_id, occurred_at);

CREATE FUNCTION record_project_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    source project_items%ROWTYPE;
    previous_status TEXT;
    next_status TEXT;
BEGIN
    IF TG_OP <> 'INSERT' AND NOT OLD.archived THEN previous_status := OLD.status; END IF;
    IF TG_OP <> 'DELETE' AND NOT NEW.archived THEN next_status := NEW.status; END IF;
    IF previous_status IS DISTINCT FROM next_status THEN
        IF TG_OP = 'DELETE' THEN source := OLD; ELSE source := NEW; END IF;
        -- During a cascade from project deletion the parent is already gone.
        INSERT INTO project_status_history (organization_id, project_id, previous_status, next_status)
        SELECT organization_id, id, previous_status, next_status FROM organization_projects
        WHERE organization_id = source.organization_id AND id = source.project_id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER record_project_status_change AFTER INSERT OR DELETE OR UPDATE OF status, archived ON project_items
FOR EACH ROW EXECUTE FUNCTION record_project_status_change();
