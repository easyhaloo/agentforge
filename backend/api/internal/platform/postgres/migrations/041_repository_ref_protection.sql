ALTER TABLE delivery_repositories ADD COLUMN protected_refs text[] NOT NULL DEFAULT '{}';
