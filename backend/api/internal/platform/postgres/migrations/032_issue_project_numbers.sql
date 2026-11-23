ALTER TABLE organization_projects ADD COLUMN number INTEGER;

WITH numbered AS (
    SELECT organization_id, id, row_number() OVER (PARTITION BY organization_id ORDER BY id) AS number
    FROM organization_projects
)
UPDATE organization_projects p SET number = n.number
FROM numbered n WHERE p.organization_id = n.organization_id AND p.id = n.id;

ALTER TABLE organization_projects
    ALTER COLUMN number SET NOT NULL,
    ADD CHECK (number > 0),
    ADD UNIQUE (organization_id, number);
