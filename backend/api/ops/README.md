# Pipeline operations

## Health and alerts

Run `psql -Xq -f pipeline-health.sql` with a PostgreSQL service account that can read the run, step, run-event and queue-event tables. Supply the connection through libpq environment variables or a service file. The sample contains aggregate counts and durations. Collect one sample per minute with your existing monitoring system and page after two consecutive failed checks. A connection or query failure also exits nonzero. The initial thresholds are five minutes for a queued run, any expired task lease, or more than half of ten or more completions failing in the past hour.

For an old queued run, check worker process health, the configured check image and worker logs. Busy workers count distinct identities holding a live lease. Approval-only waits have no worker lease. For expired leases, check that another worker can claim the task and that the lease attempt advances. For elevated failures, inspect the affected organization's run events and the candidate SHA. For repeated train rebuilds, inspect target movement and the preceding entries’ queue audit events.

## Backup and restore

1. Quiesce the API, workers and external writers to the managed repositories. Record the database and Git snapshot time together.
2. Take a PostgreSQL custom-format dump with `pg_dump -Fc -f agentforge.dump`. For each managed repository run `git -C "$repository" bundle create "$backup_file" --all`. Capture operator-managed evidence files in the same backup set. Use restricted, encrypted storage. Protect the separately managed OIDC configuration and secret-manager references through their existing recovery process.
3. Restore into an empty isolated database using `pg_restore --single-transaction --exit-on-error --no-owner -d "$PGDATABASE" agentforge.dump`. Restore each bare repository to its original organization/slug path with `git clone --mirror "$backup_file" "$destination"`. Restore evidence files with their original permissions. Run `git -C "$destination" fsck --full`.
4. Compare queue entry IDs, pinned sources, candidate SHAs and attached run IDs with the backup inventory. Confirm active candidate objects and promotion receipts resolve. Start the API and workers against the restored data. Verify run progress and scoped access before returning traffic. If the database and Git snapshot times disagree, reconcile the refs and audit records before enabling promotion.

The API CI job exercises `TestBackupRestoresCandidateAndQueue` with the PostgreSQL service container. It restores an independent database and a repository bundle, checks out the retained candidate and promotes the restored queue entry. `TestPipelineProcessRecovery` forcibly terminates and restarts the production API and worker binaries with a queued run and a running approval checkpoint, then checks the persisted success and timeout outcomes.
