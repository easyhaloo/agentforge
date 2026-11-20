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

## Run a custom Shell step

Apply `019_pipeline_scripts.sql` before rolling out the API and worker. Register a runner for the organization with a fresh token using the registration procedure above and capability `container/script@v1`. Existing registrations retain their capabilities. Preload the configured digest-pinned image with `/usr/bin/timeout`, `/bin/sh` and `head`. A runner that also advertises `container/check@v1` needs the operator's check executable. Merge queue workflows still require that fixed check.

Choose **Create → Scripts and variables** in the pipeline list. The template opens in the canvas with a `VERSION` parameter whose default is `1.0.0`. Select `make-tag` to edit its Shell command and declared output `TAG`. Select `read-tag` in the dependent stage to edit the consumer. Save the draft, publish the version, and start a run. With the default, the consumer prints `Release v1.0.0`.

```sh
# make-tag declares TAG in its Output variables field
printf 'TAG=v%s\n' "$AF_PARAM_VERSION" >> "$FLOW_ENV"
```

```sh
# read-tag runs after build succeeds
printf 'Release %s\n' "$AF_VAR_TAG"
```

`FLOW_ENV` and `AF_ENV_FILE` name the same step-local file. Write one `NAME=value` record per line for each declared output. The worker treats values as plain data. A missing, repeated or undeclared name fails the step. Names are case-sensitive and unique within the workflow. Each step supports a 16 KiB script, 16 declared outputs, 1 KiB per value and an 8 KiB output file. A workflow supports 64 output names. Only successful steps publish outputs to later steps of the same job and to downstream stages with a direct or transitive dependency. Parallel sibling jobs and unrelated stages have separate scopes.

Use ordinary values for script parameters and outputs. Scripts can read all supplied non-secret parameters in `AF_PARAMS_JSON`, including names containing `-`. Other names are also available as `AF_PARAM_<name>` with their original case. Keep the combined script run parameters within 64 KiB. Secret references are excluded, and the script step has no secret bindings. Scripts execute as a non-root user with networking disabled and a read-only root filesystem.
