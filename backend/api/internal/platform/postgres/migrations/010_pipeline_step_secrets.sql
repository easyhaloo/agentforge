ALTER TABLE pipeline_step_runs ADD COLUMN secret_refs jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(secret_refs) = 'object' AND (secret_refs = '{}'::jsonb OR capability = 'container/check@v1'));
