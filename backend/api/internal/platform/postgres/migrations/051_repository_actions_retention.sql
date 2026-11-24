ALTER TABLE delivery_repositories ADD COLUMN actions_retention_days integer NOT NULL DEFAULT 0
    CHECK (actions_retention_days BETWEEN 0 AND 400 AND (visibility <> 'public' OR actions_retention_days <= 90));

ALTER TABLE pipeline_run_events ADD COLUMN expires_at timestamptz;
CREATE INDEX pipeline_run_events_expiry ON pipeline_run_events(expires_at, seq) WHERE expires_at IS NOT NULL;
