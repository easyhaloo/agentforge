ALTER TABLE pipeline_runners DROP CONSTRAINT pipeline_runners_capabilities_check,
    ADD CHECK (cardinality(capabilities) > 0 AND array_position(capabilities,NULL) IS NULL AND
        capabilities <@ ARRAY['control/approval@v1','container/check@v1','container/script@v1']);
ALTER TABLE pipeline_step_runs ADD COLUMN script text NOT NULL DEFAULT '',
    ADD COLUMN output_names text[], ADD COLUMN exports jsonb NOT NULL DEFAULT '{}';
