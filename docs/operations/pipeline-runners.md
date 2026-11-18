# Register and operate a pipeline runner

Run `pipeline-worker` on a trusted operator host. It connects directly to PostgreSQL, and its database credentials and Docker access are privileged. Keep both outside workflow containers. Runner registration scopes the cooperative worker's scheduler operations to one active organization and an explicit list of capabilities.

## Provision

Apply migration `016_pipeline_runners.sql` before starting the new workers. Stop old worker processes during rollout. Existing leases expire after 30 seconds and a registered worker can retry them. The worker opens the database using `DATABASE_URL`.

From the API module, generate a 32-byte random token and register it once. The command prints the public runner UUID. Keep that UUID for revocation and store the token in the worker's secret manager.

```sh
export PIPELINE_RUNNER_TOKEN="$(openssl rand -hex 32)"
go run ./cmd/pipeline-worker register "$ORG_ID" 'container/check@v1' 'control/approval@v1'
```

Supply only the capabilities the host needs. Start the worker with `DATABASE_URL`, the same `PIPELINE_RUNNER_TOKEN` and a preloaded digest-pinned `PIPELINE_CHECK_IMAGE` in its environment.

```sh
go run ./cmd/pipeline-worker
```

The database stores the token digest. Events and artifact provenance identify the public UUID. A claim returns a separate receipt valid for one step attempt. An approval runner can put an approval step into the waiting state. Completing the approval requires the existing authenticated decision path.

## Control concurrency and revoke access

```sh
go run ./cmd/pipeline-worker quota "$ORG_ID" 2
go run ./cmd/pipeline-worker revoke "$ORG_ID" "$RUNNER_ID"
```

Each registration has one execution slot, including when several processes use the same token. Each organization starts with four concurrent leased steps. The existing active-run limit also applies. Lowering the slot count lets live work drain. Setting it to zero pauses new claims while workers can still mark overdue runs timed out. A waiting approval consumes no execution slot.

Revocation fences claims, heartbeats and completions as soon as the revocation transaction commits. A running check stops on its next heartbeat (normally within three seconds). The fenced lease counts against the quota until expiry to allow the worker to shut down. For rotation or a capability change, register a new token and revoke the old UUID. A revoked token cannot be registered again. Keep at least one active runner per organization to process eligible work and overdue runs.
