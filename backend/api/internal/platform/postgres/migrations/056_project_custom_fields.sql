CREATE TABLE project_fields (
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
    field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'single_select', 'iteration')),
    options JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(options) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, project_id, id),
    FOREIGN KEY (organization_id, project_id) REFERENCES organization_projects(organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX project_fields_unique_name ON project_fields (organization_id, project_id, lower(name));

CREATE TABLE project_field_values (
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    field_id UUID NOT NULL,
    value JSONB NOT NULL CHECK (jsonb_typeof(value) IN ('string', 'number')),
    PRIMARY KEY (organization_id, project_id, item_id, field_id),
    FOREIGN KEY (organization_id, project_id, item_id) REFERENCES project_items(organization_id, project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, project_id, field_id) REFERENCES project_fields(organization_id, project_id, id) ON DELETE CASCADE
);

CREATE INDEX project_field_values_by_field ON project_field_values (organization_id, project_id, field_id);
