-- Tag trigger bindings pin a glob over the tag name; tag events deduplicate per binding, ref and SHA.
ALTER TABLE pipeline_trigger_bindings ADD COLUMN tag_pattern text;
ALTER TABLE pipeline_trigger_bindings DROP CONSTRAINT pipeline_trigger_bindings_check;
ALTER TABLE pipeline_trigger_bindings ADD CHECK (
    (repository IS NOT NULL AND every_seconds IS NULL AND next_due IS NULL AND tag_pattern IS NULL) OR
    (repository IS NULL AND every_seconds IS NOT NULL AND every_seconds >= 60 AND next_due IS NOT NULL AND isfinite(next_due) AND tag_pattern IS NULL) OR
    (repository IS NOT NULL AND every_seconds IS NULL AND next_due IS NULL AND tag_pattern IS NOT NULL AND
     tag_pattern <> '' AND octet_length(tag_pattern) <= 128 AND tag_pattern !~ '[/\\]' AND tag_pattern !~ '[[:cntrl:]]'));
CREATE INDEX pipeline_trigger_tag ON pipeline_trigger_bindings(organization_id,repository) WHERE enabled AND tag_pattern IS NOT NULL;
CREATE UNIQUE INDEX pipeline_trigger_tag_push ON pipeline_trigger_events(binding_id,(source->>'ref'),(source->>'sha')) WHERE source->>'kind'='tag';
