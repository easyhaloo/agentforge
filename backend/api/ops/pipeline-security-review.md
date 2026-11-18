# Pipeline security review

## Controls checked before rollout

| Boundary | Control | Regression check |
| --- | --- | --- |
| Organization and workflow | Admission checks membership and binds the published definition and typed inputs to the run. Webhook retries share a durable identity. | `TestPipelineAuthorization`, `TestRunCreationUsesPublishedVersion`, `TestWebhookEnqueuesOnceAndScopesSecrets` |
| Runner host and container | Registrations scope claims to one organization and allowed capabilities. Revocation fences live receipts. A digest-pinned check runs without networking, with bounded CPU, memory, processes, output and runtime. Secret-bearing steps suppress output. | `TestRunnerAdmissionAndRevocation`, `TestRunnerRevocationStopsWorker`, `TestContainerCheck`, `TestSecretInputIsStepScoped` |
| Git and promotion | The binding selects the upstream. HTTPS redirects are disabled. The promotion checks the ordered candidate and target, then writes the target and receipt atomically. Recovery reconciles the original run and queue audit. | `TestRemoteGitContract`, `TestIntegrationBuildAndGatedPromotion`, `TestMergeQueueRecoveryAfterPromotionCommitFailure` |
| Stored output | The API scopes reads to the organization and run. Verified downloads check provenance, size and digest. Expiry removes bytes while retaining the manifest. | `TestPipelineObjectLifecycle`, `TestMinIOPipelineObjects` |
| Restart and recovery | PostgreSQL retains run state, runner registration and queue provenance. Restored Git refs provide the candidate used for promotion. | `TestPipelineProcessRecovery`, `TestBackupRestoresCandidateAndQueue` |

## Deployment assumptions

Use a trusted, dedicated runner host. Its database connection and Docker daemon grant host-level capabilities beyond a scheduler token. Keep the database credentials, Git token files, AWS credentials and operator-owned step secrets outside container mounts. Apply a disk quota to Git scratch storage. Use a separate read-only upstream identity on workers and restrict writes to candidate and receipt refs to the integration service. Exercise the target's branch protection in a staging repository with the deployment's actual credentials.

Provision an isolated private bucket and verify a restored object against its manifest before returning traffic. Record and reapply revocations made after the database snapshot. Schedule the health probe and cleanup job with the deployment's existing monitor and scheduler.

See [runner operations](../../../docs/operations/pipeline-runners.md), [Git bindings](../../../docs/deployment/remote-integration-git.md), [storage recovery](../../../docs/operations/pipeline-storage.md), and the [backup and alert runbook](README.md).
