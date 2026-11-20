-- Phase 5: General-purpose execution subsystem for evaluations, Git operations, and agent tasks.
-- This is distinct from pipeline_runs (Phase 7), which are workflow-specific.

CREATE TABLE executions (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('evaluation', 'git_operation', 'agent_task')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out')),
    payload JSONB NOT NULL,
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    deadline TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    CHECK ((status IN ('completed', 'failed')) = (completed_at IS NOT NULL))
);

CREATE INDEX executions_organization_status ON executions(organization_id, status)
    WHERE status IN ('queued', 'running');
CREATE INDEX executions_organization_created ON executions(organization_id, created_at DESC);

-- Tasks represent individual units of work within an execution.
-- The task lease mechanism enables safe distributed claiming.
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    capability TEXT NOT NULL DEFAULT 'default',
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'leased', 'running', 'completed', 'failed', 'cancelled', 'timed_out')),
    payload JSONB NOT NULL,
    result JSONB,
    error_message TEXT,
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    worker_id TEXT,
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    deadline TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
    CHECK ((status = 'leased') = (worker_id IS NOT NULL AND lease_until IS NOT NULL)),
    CHECK (attempt <= max_attempts)
);

CREATE INDEX tasks_claimable ON tasks(capability, created_at)
    WHERE status = 'queued' AND attempt < max_attempts AND deadline > now();
CREATE INDEX tasks_lease_expired ON tasks(lease_until)
    WHERE status = 'leased' AND lease_until <= now();
CREATE INDEX tasks_execution ON tasks(execution_id);

-- Task execution logs for debugging and audit trails
CREATE TABLE task_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
    message TEXT NOT NULL,
    attributes JSONB
);

CREATE INDEX task_logs_task_time ON task_logs(task_id, created_at);

-- Execution events for lifecycle tracking
CREATE TABLE execution_events (
    seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind TEXT NOT NULL,
    actor TEXT NOT NULL,
    message TEXT
);

CREATE INDEX execution_events_execution_seq ON execution_events(execution_id, seq);
