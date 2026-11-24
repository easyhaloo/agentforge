ALTER TABLE delivery_repositories
    ADD COLUMN ref_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT delivery_repositories_ref_rules_array CHECK (jsonb_typeof(ref_rules) = 'array');
