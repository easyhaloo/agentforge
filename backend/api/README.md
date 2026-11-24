# Go API

## Requirements

- Go 1.25+
- Docker with Compose

## Run locally

Start PostgreSQL from the repository root:

```sh
docker compose up -d postgres
```

Export the API configuration (copy `.env.example` values into your shell; the Go process does not load dotenv files automatically):

```sh
export PORT=8080
export DATABASE_URL='postgres://agentforge:agentforge@localhost:5432/agentforge?sslmode=disable'
export APP_ORIGIN='http://localhost:5173'
# Provision local Git repositories under $GIT_REPOSITORY_ROOT/<org-id>/<owner>/<repo>.
export GIT_REPOSITORY_ROOT='/var/lib/agentforge/git'
export EVIDENCE_ROOT='/var/lib/agentforge/evidence'
go run ./cmd/server
```

The server validates `PORT`, `DATABASE_URL`, and the exact `APP_ORIGIN` at startup, applies pending embedded SQL migrations, and attaches a validated `X-Request-ID` to every response. Safe incoming request IDs are preserved; invalid or oversized values are replaced. Credentialed API CORS is restricted to `APP_ORIGIN`; non-loopback origins must use HTTPS.

## Health checks

- `GET /healthz` reports process health.
- `GET /readyz` reports database, identity, CSRF, and application-origin readiness. It currently returns `503` until all trusted dependencies are configured.

## Complete Changeset lifecycle

The delivery control plane exposes an organization-scoped lifecycle:

1. **Repository metadata** — Owners and administrators register an already-provisioned Git repository and default branch. The API verifies that the branch resolves under the configured local Git root before persisting metadata.
2. **Revision** — The API resolves a branch, tag, or commit to an immutable commit SHA. A new revision invalidates prior revision evidence and review approvals.
3. **Evaluation** — Clients cannot submit a passing result. The server runs the trusted Git diff integrity evaluator and persists its outcome and report.
4. **Evidence** — Passing evaluation reports are written to content-addressed storage. Evidence metadata records the SHA-256 digest, byte size, evaluation, and revision.
5. **Review** — A review can be assigned only to an active member of the same organization and never to the changeset author. Only the assigned reviewer can approve or reject it.
6. **Merge** — The server revalidates current passing evaluation, active evidence, and approved review, then performs a no-fast-forward Git merge and persists the actual merge commit SHA.
7. **Audit and verification** — Each domain transition is appended to the changeset audit trail; PostgreSQL optimistic versions prevent stale state updates, and API/integration tests exercise the complete lifecycle.

**One active review per revision.** A revision has at most one active review. Assigning a review while another is pending supersedes it: the earlier review becomes `stale`, a `review.superseded` event is added to the audit trail, and it can no longer be decided. Once the current revision has an approved review, assigning another is refused with `409` ("Review already approved") until a new revision is added, and a new revision still invalidates pending and approved reviews. Rejected reviews stay as history. Because of this rule, `status` is `ready_to_merge` exactly when the review part of the merge gate is satisfied.

### Changeset status and list filters

Every stored-changeset response (create, get, list and each mutation) carries a server-derived `status` beside `version`. The UI displays it and never derives it (ADR-003). Only the **current** revision is judged: evaluations, evidence and reviews of older revisions never count.

| `status` | Meaning |
| --- | --- |
| `draft` | No revision yet |
| `evaluation_pending` | The current revision has no evaluation yet |
| `evaluation_failed` | The latest evaluation of the current revision failed |
| `evidence_required` | The latest evaluation passed but no evidence is active |
| `review_required` | Evidence is active but no review is assigned |
| `in_review` | The latest review of the current revision is pending |
| `changes_requested` | The latest review of the current revision rejected the changes |
| `ready_to_merge` | The current revision has an approved review |
| `merged` | A merge has been recorded |

`status` is for display and filtering, not an authorization: `ready_to_merge` means the lifecycle gates recorded for the current revision are satisfied, but `POST .../merge` re-validates the current target branch and review state when it runs and can still refuse with 409 or 422, so clients must treat merge as a command that can fail and show the server's reason.

`GET /api/v1/organizations/{organizationID}/changesets` accepts these optional filters, combined with AND:

- `repository` — exact repository match.
- `status` — one value from the table above; any other value is a `400` problem response.
- `reviewer` — a user id, or `me` for the authenticated user. Matches changesets whose current revision has a review assigned to that user, whatever its decision, except a review superseded by a newer assignment (stale), which never matches. Add `status=in_review` for a pending review queue.
- `q` — case-insensitive substring of the changeset id, title, repository or creator; at most 200 characters, otherwise a `400` problem response.

`limit` (1-100, default 20) and `offset` apply after filtering, and `total` in the response is the number of matches before paging. Results are ordered by `updated_at` descending, then by id. Filtering never crosses organizations.

Current limitation: when `repository` is the only filter (or there is none) the PostgreSQL store orders, pages and counts in SQL, so a request transfers and decodes only the requested page. A request that filters by `status`, `reviewer` or `q` still loads and decodes every changeset of the organization (of the repository when one is given) and filters them in Go, so it costs O(changesets per organization). Denormalizing the status and the current reviewers into indexed columns is the upgrade path.

### Local Git provider layout

The current provider is a local Git adapter (the provider interface is intentionally independent of Git hosting vendor APIs). An operator provisions repositories using this layout:

```text
$GIT_REPOSITORY_ROOT/
  <organization-id>/
    <owner>/
      <repository>/
```

Repositories must be initialized and contain their default branch before registration. Repositories created through the API are bare. For existing first-party checkouts, see the [bare migration runbook](../../docs/operations/git-bare-migration.md). The API does not clone arbitrary URLs, accept filesystem paths from callers, or run repository hooks. Path traversal and symlink escapes are rejected. The local adapter performs Git ref resolution and no-fast-forward merges. By default the evaluator runs `git diff --check`. For full project validation, configure `EVALUATION_DOCKER_IMAGE` (an immutable `@sha256` image reference) and `EVALUATION_COMMAND`; the API creates a server-issued evaluation job envelope containing the organization, changeset, revision, and immutable base/revision SHAs. The evaluator must return the same job identity and commit SHAs; the API rejects mismatched results before persisting any outcome. The current evaluator adapter runs synchronously in the API process and, when configured, executes the operator-defined command in a network-isolated, read-only, non-root, resource-limited container with the repository mounted read-only. The command receives `AGENTFORGE_BASE_SHA` and `AGENTFORGE_REVISION_SHA`. Build an evaluator image with all required toolchains and dependencies preloaded because the runner has no network access. The API never executes arbitrary client-supplied commands or accepts client-supplied pass/fail results. Each evaluation records the exact default-branch base commit SHA used for comparison; merge acquires a repository-wide advisory lock, resolves the target again, and rejects the merge with a stale-evaluation conflict if that base commit changed. Only the latest evaluation for the current revision can satisfy the merge gate.

Set both `GIT_REPOSITORY_ROOT` and `EVIDENCE_ROOT` to enable revision, evaluation, evidence and merge operations. Configure the digest-pinned Docker evaluator to run the repository test suite rather than only the built-in diff check. If either is absent, the related routes return `503`; the API never fabricates a revision, evaluation, evidence artifact, review, or merge. Evidence files are stored with restrictive permissions and referenced by opaque content-addressed artifact URIs rather than exposing filesystem paths.

The PostgreSQL store owns organization-scoped changesets and repository metadata. Every state update uses an expected version; a concurrent update returns `409` and must be reloaded. The API enforces session identity, active organization membership, role checks, exact Origin, and session-bound CSRF for all writes.

## Issue inbox preferences

- `GET /api/v1/users/me/notification-preferences` returns the current user's preferences. `PATCH` accepts either or both of `inbox_participating` and `inbox_watching` as booleans and returns the saved preferences. Both default to `true`. Participating covers mentions and explicit Issue subscriptions. Watching covers new Issues and comments in watched repositories.
- `GET /api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/watch` returns `{ "watching": false }` until the current user watches that repository. `PATCH` accepts `{ "watching": true }` to watch or `{ "watching": false }` to unwatch and returns the persisted state. The endpoint requires active organization membership and a registered repository. A missing or invalid `watching` value returns `400`.
- Both writes require the session and CSRF token. The web UI loads saved settings before accepting changes and retains the last confirmed value if saving fails. Changes affect future inbox delivery. Legacy email and push fields are stored for API compatibility.

## Issue notification email

Set `NOTIFICATION_EMAIL_PROVIDER` to `ses` or `sendgrid` and set `NOTIFICATION_EMAIL_FROM` to a sender address authorized by the provider. SES uses the AWS SDK credential chain and `AWS_REGION`. SendGrid uses `SENDGRID_API_KEY`. An unset provider disables email delivery while the inbox keeps working.

`GET /api/v1/users/me/notification-email` returns delivery availability, the verified and pending addresses, and the `participating` and `watching` preferences. `POST /verification` under that path accepts `{ "address": "…" }` and queues a 30-minute code, with a one-minute limit per account and destination. `POST /verify` accepts `{ "code": "…" }` and makes that address the default for notifications. `PATCH` on the settings path updates either or both preferences after verification. All writes require a session and CSRF token. Preferences default to off and apply to future issue creations and comments. Each recipient gets one email when both subscriptions match.

## Repository webhooks

Organization owners and admins manage webhooks in **Repository settings → Webhooks**. The API serves `GET` and `POST` at `/api/v1/organizations/{organizationID}/repositories/{owner}/{repo}/webhooks`, `PATCH` and `DELETE` at `/{webhookID}`, and `GET` at `/{webhookID}/deliveries` under the same path. Writes require a session and CSRF token. Signing secrets are write-only.

The API sends JSON over public HTTPS for `issues` with action `opened` and `issue_comment` with action `created`. Recipients can verify the raw request body with `X-Hub-Signature-256` (HMAC-SHA256) and use `X-GitHub-Delivery` as the delivery ID. `X-GitHub-Event` identifies the event. The worker blocks private destinations and redirects. Each delivery gets one attempt, and the latest 100 results include status and the HTTP code when available. A configuration change marks pending deliveries failed without sending them. A request already in flight can finish.

## Single sign-on

Google and GitHub are independently optional. Set each enabled provider's Client ID and Client Secret in the API environment using secret-managed values. Register the exact callback URL with the provider.

| Provider registration | API environment variables | Callback path on `APP_ORIGIN` |
| --- | --- | --- |
| Google OAuth web application | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `/auth/google/callback` |
| GitHub OAuth App | `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | `/auth/github/callback` |

Proxy `/auth/*` through the same public origin as the web UI. The provider must allow that origin's callback URL, including the exact scheme and port. Use HTTPS outside loopback development. GitHub requests only `user:email`. An invitation must match the GitHub account's verified primary email or a verified Google email.

`GET /auth/providers` lists the configured providers that initialized successfully. Login and registration read this list and leave password authentication available. For a rollout, restart the API after injecting the desired credentials, check the list through the web origin, and verify a member login and a new invitation for each provider. Removing a provider's credential pair and restarting hides its entry and disables its login and callback routes.

External identities use the provider's immutable account ID. Existing `(issuer, subject)` mappings are preserved. New external identities with a matching profile email get a separate AgentForge account, including when a password account already uses that email. The new identity needs its own membership or a matching invitation. Password sign-in remains available to its original account.

### Generic OIDC

OIDC login is optional during local foundation work. When enabled, configure all four values together:

- `OIDC_ISSUER_URL`: the provider's discovery issuer URL.
- `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`: confidential client credentials.
- `OIDC_REDIRECT_URL`: the exact API callback URL registered with the provider, ending in `/auth/oidc/callback`.
- `SESSION_TTL`: optional duration from `5m` to `168h`; defaults to `12h`.

The provider must support OIDC discovery, Authorization Code flow, and PKCE S256. The API validates the ID-token signature, issuer, audience, time claims, and nonce using the provider's discovery/JWKS metadata. State, nonce, and PKCE verifier are held in short-lived Secure, HttpOnly, host-only cookies; the one-time state and nonce hashes are stored in PostgreSQL to prevent callback replay.

Routes:

- `GET /auth/oidc/login` starts login.
- `GET /auth/oidc/callback` validates the provider response and creates the application session.
- `POST /api/v1/auth/logout` revokes the current session and clears both session cookies. It requires the configured Origin and session-bound CSRF header/cookie.

A disabled provider or a provider whose discovery failed returns `503` at its own login route. A successful OIDC login creates or updates a local user by the immutable `(issuer, subject)` pair; it does not grant organization membership. An operator-controlled first-owner/bootstrap step is still required before the user can access tenant-scoped delivery resources.

### Production OIDC Configuration

For production deployment with Google, Okta, Auth0, Microsoft Entra ID, or GitLab, see the complete configuration guide:

**[Production OIDC Configuration](../../deployments/production/OIDC-CONFIGURATION.md)**

The guide includes:
- Provider-specific setup instructions
- Environment variable reference
- Security considerations
- Kubernetes deployment example
- Troubleshooting steps

## First-owner bootstrap (operator-only)

A verified SSO identity requires active membership or a matching invitation before the API creates a session. Provision the first owner from a trusted operator environment with direct database access.

For Google use issuer `https://accounts.google.com` and the account’s OIDC `sub`. For GitHub use issuer `https://github.com` and the decimal account `id` from GitHub’s user API. For generic OIDC use its exact issuer and `sub`.

```sh
export DATABASE_URL='postgres://agentforge:agentforge@localhost:5432/agentforge?sslmode=disable'
export BOOTSTRAP_OIDC_ISSUER='https://identity.example.com'
export BOOTSTRAP_OIDC_SUBJECT='the-exact-immutable-sub-claim'
export BOOTSTRAP_ORGANIZATION_ID='your-organization-id'
export BOOTSTRAP_ORGANIZATION_NAME='Your Organization'
go run ./cmd/bootstrap-owner
```

The command creates the organization if needed, maps the issuer/subject to a local user, and assigns the `owner` role in one transaction. It serializes concurrent attempts and refuses to proceed if the organization already has an owner or is suspended. Re-running bootstrap is not a role-escalation or recovery mechanism; existing organizations must use a separately authorized membership-management workflow.

### Organization slugs

Organizations get a unique, human-readable slug besides their opaque `id`, so clients and agents can build readable paths such as `/api/v1/organizations/acme/changesets`.

- **Resolution.** Every `/api/v1/organizations/{organizationID}/...` path accepts the organization slug or id. Slugs match case-insensitively; ids match exactly. The handle is resolved only among the caller's own active memberships, so the slug of an organization the caller cannot access gets the same `401` as an unknown handle; so does a malformed handle (containing a NUL byte, not valid UTF-8, or longer than 256 bytes). A handle that equals another organization's id wins over that organization's slug. Storage and handlers always use the canonical id.
- **`GET /api/v1/me`** returns each organization's `slug`. Organizations created by direct SQL without a slug use their id as handle, and `/me` reports that id as the slug; such an id can contain characters a slug cannot (capitals, `_`, `.`), so every organization always has a handle.
- **Format.** 1-39 characters from `a-z`, `0-9` and `-`, starting and ending with a letter or digit. `current` is reserved (clients use it as an alias for the selected organization) and is never assigned.
- **Backfill.** Migration `007_organization_slug.sql` derives slugs for existing organizations from their names (lowercase, other characters become `-`, `-2`, `-3`, ... on collisions, oldest organization first). The API has no way to rename a slug yet.
- **Bootstrap.** Set the optional `BOOTSTRAP_ORGANIZATION_SLUG`; otherwise the slug is derived from `BOOTSTRAP_ORGANIZATION_NAME`. An invalid or reserved slug aborts the bootstrap with an error. When the organization is created, so does a slug that is already used or that equals another organization's id, or an id that equals another organization's slug, ignoring case. An existing organization is never modified and keeps its slug.

### Organization pipelines

Open **CI / CD** in the organization sidebar to start from an approval or check-then-approve template, clone a workflow, edit stages, jobs, steps and typed parameters visually or as JSON, and publish the saved draft. Members can create and edit. Owners and admins can also publish and archive. Viewers can read definitions and version history. Use the published version selector to start an immutable version with runtime overrides. Clearing a runtime control restores the published default or omits the optional input.

The API is rooted at `/api/v1/organizations/{organizationID}/pipelines`. Saving a draft, publishing and archiving require the current `revision`. A `409` means the lifecycle or revision changed. Reload and compare the saved draft before retrying. Archiving preserves published versions. A version's checksum is SHA-256 over its stored UTF-8 JSON bytes. Migration `008_pipelines.sql` creates `pipelines`, `pipeline_versions` and `pipeline_audit`. Each successful mutation writes the actor and revision to the audit table in the same transaction.

Each stage with omitted or null `dependsOn` follows the previous stage. An empty array explicitly selects an independent stage. Node IDs must be unique across the workflow. Runtime parameter overrides require `override: true`. Secret parameters accept `secret://name` references. `POST /{id}/versions/{number}/validate-inputs` accepts an object keyed by parameter name and returns `204` for valid overrides of that published version.

The OpenAPI contract imports the same v1 JSON Schema that the API embeds. Regenerate frontend types from the repository root when changing it.

```sh
npx --yes openapi-typescript@7.10.1 contracts/openapi/pipelines.yaml -o apps/web/src/shared/api/pipeline-contract.d.ts
```

### Starting and observing a pipeline run

Post a JSON object of parameter overrides to `/api/v1/organizations/{org}/pipelines/{id}/versions/{number}/runs`. The response includes the run ID, actor, immutable published version, resolved defaults and a one-hour deadline. Each organization can have 16 active runs. Archived pipelines reject new runs. Read status at `/api/v1/organizations/{org}/pipeline-runs/{run}`. Its `/events` endpoint replays up to 128 audit events over SSE and resumes from `Last-Event-ID`. Members can post to `/cancel`. Owners and admins can post `{"approved":true}` or `{"approved":false}` to `/steps/{step}/decision` when an approval is waiting.

Start the separate worker with `go run ./cmd/pipeline-worker` from the API module. Provide `DATABASE_URL`, `PIPELINE_CHECK_IMAGE` and a registered `PIPELINE_RUNNER_TOKEN` in its environment. See [runner registration, quotas and revocation](../../docs/operations/pipeline-runners.md). Use a dedicated Docker runner with a preloaded operator-controlled digest-pinned image containing `/usr/bin/timeout` and an executable `/usr/local/bin/agentforge-check`. The `container/check@v1` step invokes that check as an unprivileged user with a read-only filesystem, disabled networking and a two-minute time limit. Each worker claims one step at a time. A lost lease becomes available after 30 seconds. Three abandoned attempts fail the run. The worker captures up to 8 KiB of stdout for checks without secret references. With [object storage](../../docs/operations/pipeline-storage.md) enabled, the run records a log reference and an outcome artifact. Otherwise, permitted output is stored inline in run events. Checks receive no host credentials or user-supplied environment.

For a container step, `secretParams` lists up to 16 parameters of type `secretRef`. Bind each parameter in the visual editor or the workflow JSON. Provision UTF-8 values of up to 16 KiB through an external secret manager mounted read-only at `PIPELINE_SECRETS_DIR/{organizationID}/{pipelineID}/{stepID}/{name}` on the worker. The operator controls all directories. Missing or inaccessible references fail the step. The check receives a JSON object on stdin keyed by parameter name. The worker discards output from checks that receive secrets and records a `secret_refs_requested` event for the attempt. The API and run snapshot contain reference names only.

### GitHub webhook triggers

For a release tag, configure `event` as `push` and set `tag` to the exact short tag name. Supply exactly one of `tag` and `branch`. The signed event must name the matching full ref. Deleted tags are rejected. Retries reuse the same run and its pinned SHA.

Set `PIPELINE_WEBHOOKS_DIR` on the API to an absolute, operator-controlled directory mounted from your secret manager. Provision `{hook}.json` with `organizationID`, `pipelineID`, `version` (published version number), `actorID` (an active member allowed to start runs), numeric GitHub `repositoryID`, `branch` or `tag`, `event` and `secret`. Use an independent random secret of at least 32 bytes for each hook. Configure GitHub to send JSON to `POST /hooks/github/{hook}` over HTTPS with that secret. Rotate the binding and GitHub secret together. Remove the binding to disable delivery.

Choose `push` for updates to the named branch, or `pull_request` for same-repository PRs targeting that branch on open, reopen or synchronize. Fork PRs are rejected. The handler verifies the raw-body HMAC, then checks the repository and branch before queuing the configured version with its published defaults. A run records the signed event's head SHA. A `202` acknowledges both accepted deliveries and retries. Duplicate delivery IDs or identical signed bodies cannot create another run. A `409` indicates a reused delivery ID with different contents or a workflow configuration conflict. Check the binding and required defaults before retrying. A `429` can be retried once an organization run slot becomes available.

### Timers and Changeset revisions

Operators provision bindings on the database. Each binding names an organization, a published workflow version and a member who can start runs. For example, use these parameterized statements for an hourly timer and a repository revision subscription, respectively.

```sql
INSERT INTO pipeline_trigger_bindings(organization_id,pipeline_id,version,actor_id,every_seconds,next_due)
VALUES ($1,$2,$3,$4,3600,$5::timestamptz) RETURNING id;
INSERT INTO pipeline_trigger_bindings(organization_id,pipeline_id,version,actor_id,repository)
VALUES ($1,$2,$3,$4,$5) RETURNING id;
```

Timers use fixed intervals of at least 60 seconds. `next_due` anchors the cadence. After downtime the API coalesces missed ticks into the latest elapsed slot. A revision subscription captures future Git-backed revisions in the same transaction as the Changeset write. Each run records the binding and either the scheduled time or the repository, Changeset ID, Revision ID and full commit SHA.

Set `enabled=false` to disable a binding. Provision a new binding to change its destination or actor. Pending deliveries recheck authorization and use the published input defaults. Quota pressure defers admission. Inspect `pipeline_trigger_events` by `binding_id` for pending (`outcome IS NULL`), `queued` (with `run_id`), `disabled`, `denied` or `invalid` deliveries. Each API process dispatches up to one event per second.

### Ordered merge previews

Provision each registered repository and its Git metadata under the owning organization's directory. Operators own Git configuration, object stores and alternates. Keep this storage separate from runner write mounts. Query `GET /api/v1/organizations/{organizationID}/merge-preview/capabilities` to discover `orderedMergePreview`. The local adapter requires the modern `git merge-tree --write-tree` interface with NUL-delimited conflict paths (Git 2.38+). The capability is probed on the API host.

Owners, admins and members can POST `{"repository":"owner/repo","target":"main","sources":["topic-a","topic-b"]}` with the usual session and CSRF headers to `/api/v1/organizations/{organizationID}/merge-preview`. Supply short branch names or full commit IDs, in integration order. The response includes the pinned target and all sources. A conflict returns HTTP 200, `status: conflict`, the zero-based `conflictAt` index and affected paths. A clean response includes a deterministic candidate commit and tree SHA. Previews use an expendable bare clone and do not retain candidate objects. They run no builds or submodule fetches. Unsupported Git or operational failures return 503. Each API process allows one preview at a time (429 while busy), up to 32 sources and 1 MiB of output per Git command. Put the API temporary directory on a size-limited volume.

### Candidate builds and promotion

For [remote integration Git](../../docs/deployment/remote-integration-git.md), configure the upstream bindings on both the API and worker. For local Git, set `GIT_REPOSITORY_ROOT` on the API and worker to their respective views of the same repositories. The API needs write access. The worker reads the retained commit into a temporary checkout. The Docker daemon must be able to bind mount the worker's temporary directory at the same path. Place a disk quota on the temporary volume. The pinned check receives a read-only `/workspace` with the candidate files and `AGENTFORGE_REVISION_SHA`. Submodules are not populated.

POST a preview request plus optional workflow `inputs` to `/api/v1/organizations/{organizationID}/pipelines/{id}/versions/{number}/integration-runs`. A clean integration returns a run with immutable target, ordered sources, strategy, tree and commit. The published workflow must include a container check. Use `merge-commit` (default) for an ordered series of merge commits, or `ff-only` to require that each successive source descends from the previous tip. Conflicts return 409 before scheduling a build.

To promote, an owner or admin posts `{"candidateSHA":"<reviewed commit>"}` to `/api/v1/organizations/{organizationID}/pipeline-runs/{run}/promote`. The local target must be the registered default branch in an operator-managed bare repository where AgentForge owns promotion policy. The API checks the successful run and every included Changeset's current revision, evaluation against the same base, evidence and approval. It advances the branch with an expected-old-SHA update and creates a receipt at `refs/agentforge/promotions/<run-id>` in one Git transaction. The database records the actor, resulting SHA and Changeset merges. Retry the same request following a lost response. A moved target needs a fresh build and approval. Back up the Git object store and its `refs/agentforge/` namespace with the database. Retained candidate objects count toward repository disk usage.

### Operating a merge queue

Open a published workflow version on the organization’s Pipelines page, expand **Merge queue**, enter the registered repository and its default branch, then refresh. Members can enqueue a single source branch or commit with the selected version and inputs. Admission pins the source SHA. The active queue holds up to 32 distinct source commits per organization, repository and target. Entries keep their original FIFO positions through rebuilds. Each build tests the ordered source prefix through that entry.

Only the head can advance the branch. An owner or admin approves its exact successful candidate. Earlier entries waiting for approval can block later entries indefinitely. Review or remove a stalled head to resume progress. Removal, failed checks and successful promotion invalidate later builds. An external branch update requires fresh builds. The queue releases superseded workers’ leases and records transitions in `merge_queue_events`. Use **Refresh queue** to see the new order, build state and candidate SHA. Queue positions and tasks survive process restarts in PostgreSQL. Restore the corresponding Git objects and AgentForge refs along with the database.

## Git Smart HTTP

Set `GIT_SMART_HTTP_ENABLED=1` with `GIT_REPOSITORY_ROOT` and Git's `git-http-backend` available on the API host. Forward `/git/` to the API without rewriting the path or query, and preserve `Authorization`, `Git-Protocol` and the request body. Vite already provides this route. Use HTTPS outside loopback. Serve only managed standalone bare repositories and migrate existing first-party checkouts using the runbook above.

Open **Code → Clone**, copy the clone URL and issue a credential. Git Basic authentication uses `git` as the username and the one-time token as the password. A credential is scoped to its issuer and repository, expires after one hour and can be revoked using its ID. Keep the token out of URLs, shell arguments and logs. A write credential can push work branches and tags. Update the default branch through the Changeset review and candidate promotion flow.

Accepted writes record an event under `<git-root>/.agentforge-push-events`. The API retries interrupted receives against their current refs and projects same-repository `#number` commit references into Issue development links. Preserve the journal and its `projected/` archive in Git storage backups. Confirm the API has stopped before moving Git storage. Unset `GIT_SMART_HTTP_ENABLED` to close the transport without discarding Git objects or audit events.
