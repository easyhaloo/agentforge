# Remote Git for integration CI

The GitHub and GitLab adapters fetch named branches or full commit IDs over HTTPS, simulate the ordered merge locally, and retain a clean candidate on the configured upstream. Preview alone leaves upstream refs untouched. A worker can fetch the candidate after the source branch moves or disappears.

## Bind the API and worker

Set `GIT_REMOTE_BINDINGS_FILE` on the API and pipeline worker to an operator-managed JSON file. Use the same organization ID, catalog slug and canonical upstream on both services. Mount credentials separately so each process has only the permissions it needs. A file can contain bindings for both provider types.

```json
[
  {
    "provider": "github",
    "organizationId": "org-1",
    "repository": "team/service",
    "url": "https://github.example/team/service.git",
    "tokenFile": "/run/secrets/service-git-token"
  },
  {
    "provider": "gitlab",
    "organizationId": "org-2",
    "repository": "platform/api",
    "url": "https://gitlab.example/platform/subgroup/api.git",
    "caFile": "/etc/agentforge/gitlab-ca.pem",
    "tokenFile": "/run/secrets/api-git-token"
  }
]
```

`organizationId` is the API organization ID. `repository` is its registered slug. Both match exactly. `url` is an HTTPS clone URL. Embedded credentials, redirects and URL parameters are rejected. The optional `caFile` and `tokenFile` are absolute host paths. Without `caFile`, Git uses its default TLS trust. Without `tokenFile`, Git connects anonymously. For worker checkout, grant read-only access and keep the token file outside the checkout. The adapter reads the token for each network command and uses `x-access-token` for GitHub or `oauth2` for GitLab.

The API loads the file at startup. Invalid configuration stops startup. The worker loads its file at each integration checkout. With a bindings file, integration operations require an explicit binding for every participating repository. Without one, integration uses `GIT_REPOSITORY_ROOT`. Repository registration, Changeset revision operations and local evaluators continue to use `GIT_REPOSITORY_ROOT` in either mode. Provision the corresponding local repository for registration and maintain its refs for those consumers.

Drain queued and running builds, resolve pending promotions and recover any outstanding receipts before switching providers or rebinding a repository. Stop writers, deploy matching configurations and restart the API before resuming builds. Bind each physical upstream to one organization and slug. The loader rejects repeated keys and canonical clone URLs across provider labels and organizations. Use a single hostname and clone path for each upstream, including on hosts with DNS aliases or secondary clone routes.

The server identity needs permission to read the repository, create candidate and receipt branches, and fast-forward the configured integration target under its existing branch rules. Scope write access to the intended refs. Reserve `agentforge/**` for the service and prevent other writers from forging receipts. Configure hosted automation so publishing an unevaluated candidate cannot execute workflows with privileged runners or secrets. Candidate and receipt refs are ordinary upstream branches and can generate push events.

## Promotion and recovery

| Upstream ref | Purpose |
| --- | --- |
| `refs/heads/agentforge/integration/<candidate-sha>` | Retains the immutable candidate for checkout and history inspection. Builds receive the checked-out files with Git metadata removed. |
| `refs/heads/agentforge/promotions/<run-id>` | Records the candidate SHA advanced by this run. Keep this ref through recovery. |

Promotion verifies the retained SHA and base ancestry, then sends an atomic push with explicit expected old values for the target and the absent receipt. A service-owned pre-push check in the private scratch repository requires both updates in Git's outgoing command set. This also catches a target independently advanced to the same candidate. Repository-supplied hooks and ambient Git configuration stay disabled. A target already equal to its candidate before preparation is a no-op and cannot be promoted. Legacy `MergeRevision` returns `ErrProviderUnavailable` because its contract has no expected target SHA.

Recovery callers use `HasPromotion(ctx, org, repository, runID, candidateSHA)` with the immutable run record.

| Result | Action |
| --- | --- |
| `true, nil` | Reconcile the recorded run, including after a lost reply or later target movement. |
| `false, nil` | The upstream advertised no matching receipt. Retry only through the normal promotion gates. |
| `ErrCandidateStale` from promotion | The target moved before the guarded update. Prepare and evaluate a fresh candidate. |
| `ErrRepositoryInvalid` | Check the binding, ref names, candidate identity or receipt collision. Preserve mismatching refs for inspection. |
| `ErrProviderUnavailable` | Check reachability, trust, credentials, server branch rules and atomic-push support. Recheck the receipt after restoring access. |

Every operation uses a fresh temporary repository and a bounded context. Provide scratch disk for fetched history and checkout. Provide a Git-capable API and worker runtime with Git HTTPS transport and CA certificates. Build the Git-enabled API with `docker build --target integration-api -t agentforge-integration-api backend/api` from the repository root. The default target remains the distroless API. The API also needs `/bin/sh` and executable scratch storage for the promotion guard. The Git client must support `merge-tree --write-tree`, `--config-env`, and atomic push. Keep atomic push enabled on the upstream. A failed transaction leaves both refs untouched. After a transport failure the outcome can be unknown until the receipt is readable.

## Retention and verification

Remote candidates live on the upstream. Local mirror cleanup alone cannot release them. Multiple runs can share a SHA. Once checkout, promotion, retry and database recovery have released a candidate, and concurrent preparation is excluded, `DeleteCandidate(ctx, org, repository, sha)` deletes only that SHA's candidate ref using an explicit lease. Repeating cleanup on an absent candidate succeeds. The offline pruner can use the same provider as the API through `delivery.LoadIntegrationGit(bindingsFile, localRoot, timeout) (delivery.IntegrationGitProvider, error)` using `GIT_REMOTE_BINDINGS_FILE` and `GIT_REPOSITORY_ROOT`. The store or operator owns the liveness decision, including candidates retained before a failed run insert. Keep receipts separate from candidate cleanup.

Run the contract suite from the backend Go module.

```sh
go test -race ./internal/delivery -run 'Test(Remote|LoadIntegrationGit)' -count=1
```

The suite starts loopback TLS servers with Git's HTTP backend, temporary bare repositories and fixture-only credentials. It exercises both authentication profiles, target movement during receive-pack, atomic capability refusal, lost replies, receipt replay and leased deletion. Hosted provider policies require separate deployment verification.
