ALTER TABLE organizations ADD COLUMN runner_slots integer NOT NULL DEFAULT 4 CHECK (runner_slots >= 0);

CREATE TABLE pipeline_runners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id text NOT NULL REFERENCES organizations(id),
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    capabilities text[] NOT NULL CHECK (cardinality(capabilities) > 0 AND
        array_position(capabilities,NULL) IS NULL AND
        capabilities <@ ARRAY['control/approval@v1','container/check@v1']),
    registered_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

-- Existing leases have no receipt. They can expire and be retried by a registered runner.
ALTER TABLE pipeline_step_runs ADD COLUMN lease_digest bytea,
    ADD CONSTRAINT require_registered_lease CHECK (status <> 'leased' OR lease_digest IS NOT NULL) NOT VALID;
CREATE INDEX pipeline_live_leases ON pipeline_step_runs(run_id,worker_id,lease_until) WHERE status='leased';
