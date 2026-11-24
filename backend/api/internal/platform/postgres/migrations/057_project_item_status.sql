-- Keep project status independent of the issue or pull request lifecycle.
UPDATE project_items SET status = 'todo' WHERE status IS NULL;
ALTER TABLE project_items
    ALTER COLUMN status SET DEFAULT 'todo',
    ALTER COLUMN status SET NOT NULL;
