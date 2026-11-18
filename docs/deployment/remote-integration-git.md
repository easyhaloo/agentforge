# Remote Git for integration CI

The GitHub and GitLab adapters fetch named branches or full commit IDs over HTTPS, simulate the ordered merge locally, and retain a clean candidate on the configured upstream. Preview alone leaves upstream refs untouched. A worker can fetch the candidate after the source branch moves or disappears.

## Bind the API and worker

Construct `delivery.NewRemoteGitProvider(bindings, timeout)` with operator-owned bindings. Each `delivery.RemoteGitRepository` has the following fields.

| Field | Value |
| --- | --- |
| `Provider` | `github` or `gitlab` |
| `OrganizationID`, `Repository` | Exact API organization ID and registered repository slug |
| `URL` | Canonical HTTPS clone URL, including the group path for GitLab subgroups. Embedded credentials, redirects and URL parameters are rejected. |
| `TokenFile` | Optional absolute path to a mounted repository-scoped token. The adapter rereads it for each network command. |
| `CAFile` | Optional absolute path to a PEM trust bundle for the host. Otherwise Git uses its default TLS trust. |

Pass the provider to the server's delivery and train dependencies. Keep `GitDiffEvaluator` and `DockerEvaluator` on the local-provider wiring because both require a `LocalGitProvider`. The worker needs the same binding for `CheckoutCandidate` and can use a read-only token. A GitHub App installation token uses the `x-access-token` username. A GitLab repository token usable with Git over HTTPS uses `oauth2` as the username. Keep token files readable only by the relevant service identity. Use a canonical URL provisioned by an operator for one tenant per upstream repository. Keep this mapping independent of request inputs and webhook clone URLs.

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

Every operation uses a fresh temporary repository and a bounded context. Provide scratch disk for fetched history and checkout. The Git client must support `merge-tree --write-tree`, `--config-env`, and atomic push. Keep atomic push enabled on the upstream. A failed transaction leaves both refs untouched. After a transport failure the outcome can be unknown until the receipt is readable.

## Retention and verification

Remote candidates live on the upstream. Local mirror cleanup alone cannot release them. Multiple runs can share a SHA. Once checkout, promotion, retry and database recovery have released a candidate, and concurrent preparation is excluded, `DeleteCandidate(ctx, org, repository, sha)` deletes only that SHA's candidate ref using an explicit lease. Repeating cleanup on an absent candidate succeeds. The store or operator owns the liveness decision, including candidates retained before a failed run insert. Keep receipts separate from candidate cleanup.

Run the contract suite from the backend Go module.

```sh
go test -race ./internal/delivery -run TestRemote -count=1
```

The suite starts loopback TLS servers with Git's HTTP backend, temporary bare repositories and fixture-only credentials. It exercises both authentication profiles, target movement during receive-pack, atomic capability refusal, lost replies, receipt replay and leased deletion. Hosted provider policies require separate deployment verification.
