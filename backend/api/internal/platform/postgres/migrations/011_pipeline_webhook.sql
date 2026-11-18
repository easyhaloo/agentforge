ALTER TABLE pipeline_runs ADD COLUMN webhook jsonb;
CREATE UNIQUE INDEX pipeline_webhook_delivery ON pipeline_runs (organization_id,(webhook->>'hook'),(webhook->>'delivery')) WHERE webhook IS NOT NULL;
CREATE UNIQUE INDEX pipeline_webhook_payload ON pipeline_runs (organization_id,(webhook->>'hook'),(webhook->>'digest')) WHERE webhook IS NOT NULL;
CREATE TRIGGER immutable_webhook BEFORE UPDATE OF webhook ON pipeline_runs FOR EACH ROW EXECUTE FUNCTION reject_pipeline_version_change();
