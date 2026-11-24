# Pipeline artifact and log storage

## Enable storage

Provision a private general-purpose S3 bucket. Set these variables on every API, worker and cleanup process, then restart them. `postgres.Open` loads the settings. Keep bucket identity, endpoint and versioning mode stable for the lifetime of its manifests.

| Setting | Value |
| --- | --- |
| `PIPELINE_S3_BUCKET` | Existing bucket name. Leave all three `PIPELINE_*` storage settings unset to use the existing inline log events. |
| `AWS_REGION` | Signing region, including for compatible endpoints. |
| `PIPELINE_S3_ENDPOINT` | Optional HTTPS origin for a path-style compatible service such as MinIO. HTTP works on loopback for testing. Omit for the SDK's regional Amazon S3 endpoint. |
| `PIPELINE_STORAGE_DAYS` | Default and upper limit for new object-storage payloads. Default 30 days, range 1–3650. Existing expiry timestamps stay fixed. |

Repository owners and admins can shorten retention for new logs and artifacts in **Settings → Actions**. Zero inherits the platform policy. With PostgreSQL-only storage, the repository setting controls newly stored inline log expiry. For workflows covering two repositories, the shorter configured retention applies.

The AWS SDK for Go v2 loads credentials through its default chain. Use workload roles or protected credential files. Keep credentials outside pipeline definitions, container mounts, logs and command arguments. Limit permissions to `pipeline-objects/v1/*`. Workers need `s3:PutObject`, the API needs `s3:GetObject` and `s3:GetObjectVersion`, and cleanup needs `s3:DeleteObject` and `s3:DeleteObjectVersion`. Configure the bucket's required encryption and corresponding KMS permissions when applicable. The service does not provision buckets or grant public access.

## Published outputs and reads

A lease-fenced completion writes `result.json` with the recorded step outcome. A nonempty, permitted worker stdout prefix becomes `stdout.txt`. The bundled worker captures up to 8 KiB before UTF-8 sanitization. The storage hook accepts up to 16 KiB of sanitized log text. Secret-bearing steps publish only the outcome. The event stream emits `log_stored` for an archived log. Existing inline logs and local Changeset evaluation evidence retain their original storage. The bundled worker automatically publishes the outcome and permitted stdout. It does not scan workspace files or capture stderr.

A trusted runner host may also publish one binary file, `artifact.bin`, up to 8 MiB per live attempt. Call `Store.PublishTaskArtifact` with the claimed task, the expected lowercase hexadecimal SHA-256 and an input reader. Alternatively, run the following command from the backend Go module. Set `DATABASE_URL`, the S3 settings above and `PIPELINE_ATTEMPT_RECEIPT` in the trusted process environment. The receipt comes from `ClaimTask` and is private to this attempt. Never pass it into the check container or a command argument.

```sh
go run ./cmd/pipeline-artifact-upload "$RUN" "$STEP" "$ATTEMPT" "$SHA256" < "$FILE"
```

Upload before `FinishTask`. Publication checks the registered runner, attempt, live lease, deadline and persisted secret references. Repeating identical content during the live attempt succeeds with the original manifest. A different digest for an already published artifact is a conflict. The file becomes available immediately and stays attributed to that attempt even if the step subsequently fails. The HTTP API exposes listing and download only.

* `GET /api/v1/organizations/{organizationID}/pipeline-runs/{run}/objects?after={id}` returns up to 100 audit records in ascending ID order. Omit `after` for the first page and pass the last ID for the next page. Expired and purged records remain visible.
* `GET /api/v1/organizations/{organizationID}/pipeline-runs/{run}/objects/{id}` downloads verified bytes as an attachment. `X-Artifact-SHA256` carries the hex digest. Both routes require a session with organization read access. Cross-organization or unknown objects return 404 after membership authorization. An expired payload returns 410. A failed integrity check or unavailable bucket returns 503 with no payload bytes.

PostgreSQL migration `017_pipeline_objects.sql` stores the manifest, bucket and S3 version ID. Provenance includes the organization, published workflow ID, version and definition checksum, run, step, attempt, public runner ID, artifact kind and name. The source SHA is the integration candidate, webhook SHA or Changeset trigger SHA when available. The key is `pipeline-objects/v1/{sha256-of-v1-provenance-json}/{payload-sha256}`. The worker sends the S3 SHA-256 request checksum. Downloads pin the recorded version and verify the object's provenance metadata, byte length and SHA-256 before releasing bytes. Keep the v1 provenance encoding stable when extending this format.

## Retention and recovery

Run `go run ./cmd/pipeline-storage-gc` from the backend Go module with `DATABASE_URL` and the storage settings above. Schedule it at an interval appropriate to the deletion SLA. Each invocation removes up to 100 expired object payloads and 100 expired PostgreSQL logs. Inline log cleanup also runs with only `DATABASE_URL` configured. A full batch prints a message to run it again. Parallel cleanup processes skip locked rows. Expiry stops downloads regardless of the cleanup schedule.

Cleanup deletes the recorded key and version, then sets `purged_at`. A failed delete returns a nonzero exit and leaves the row pending for retry. The audit row, checksum, provenance, byte count, timestamps and run events survive deletion. To inspect the backlog, group it by bucket so a configuration mismatch remains visible.

```sql
SELECT bucket, count(*) AS pending, min(expires_at) AS oldest_expiry
FROM pipeline_objects
WHERE expires_at <= now() AND purged_at IS NULL
GROUP BY bucket;
```

Writes use a ten-second object I/O budget inside each publication transaction. Failed writes roll back the step completion and its metadata. A successful PUT followed by a rollback can leave an unreferenced object. Configure a bucket lifecycle rule on `pipeline-objects/v1/` with a cutoff later than the longest retention you have issued, including older configuration values. In versioned buckets include noncurrent version expiry and expired delete-marker cleanup. Monitor completion failures and pending cleanup. Keep backup and replication retention aligned with your required deletion window.

Back up PostgreSQL together with bucket objects, their metadata and referenced versions. On restore, list a known run, download an unexpired payload and compare the returned SHA-256 against the restored manifest. Versioned restores must preserve the referenced version IDs. A PostgreSQL-only restore recovers the audit, but payload verification also needs the corresponding bucket data.

## Verification

From the backend Go module, `go test ./internal/artifact` checks configuration. `TEST_MINIO_BINARY=/absolute/path/to/minio go test -count=1 -run TestMinIOPipelineObjects ./internal/artifact` starts and stops a disposable local MinIO instance. With a scratch-capable PostgreSQL `DATABASE_URL`, `go test -count=1 -run TestPipelineObjectLifecycle ./internal/platform/postgres` exercises worker completion, the binary upload and cleanup commands, authenticated downloads, cross-tenant isolation, secret suppression, checksum and provenance failures, and retention retry.
