ALTER TABLE executions
    DROP CONSTRAINT executions_check,
    ADD CONSTRAINT executions_terminal_completed_at CHECK (
        (status IN ('completed', 'failed', 'cancelled', 'timed_out')) = (completed_at IS NOT NULL)
    ) NOT VALID;

-- Preserve existing terminal rows that predate the corrected timestamp check.
UPDATE executions
SET completed_at = COALESCE(started_at, created_at)
WHERE status IN ('cancelled', 'timed_out') AND completed_at IS NULL;

ALTER TABLE executions VALIDATE CONSTRAINT executions_terminal_completed_at;

-- The previous constraint did not allow running tasks to hold a lease.
UPDATE tasks
SET status = 'queued', worker_id = NULL, lease_until = NULL
WHERE status = 'running';

ALTER TABLE tasks
    DROP CONSTRAINT tasks_check,
    ADD CONSTRAINT tasks_active_lease CHECK (
        (status IN ('leased', 'running')) = (worker_id IS NOT NULL AND lease_until IS NOT NULL)
    );

DROP INDEX tasks_lease_expired;
CREATE INDEX tasks_lease_expired ON tasks(lease_until) WHERE status IN ('leased', 'running');
