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

Repositories must be initialized and contain their default branch before registration. The API does not clone arbitrary URLs, accept filesystem paths from callers, or run repository hooks. Path traversal and symlink escapes are rejected. The local adapter performs Git ref resolution and no-fast-forward merges. By default the evaluator runs `git diff --check`. For full project validation, configure `EVALUATION_DOCKER_IMAGE` (an immutable `@sha256` image reference) and `EVALUATION_COMMAND`; the API creates a server-issued evaluation job envelope containing the organization, changeset, revision, and immutable base/revision SHAs. The evaluator must return the same job identity and commit SHAs; the API rejects mismatched results before persisting any outcome. The current evaluator adapter runs synchronously in the API process and, when configured, executes the operator-defined command in a network-isolated, read-only, non-root, resource-limited container with the repository mounted read-only. The command receives `AGENTFORGE_BASE_SHA` and `AGENTFORGE_REVISION_SHA`. Build an evaluator image with all required toolchains and dependencies preloaded because the runner has no network access. The API never executes arbitrary client-supplied commands or accepts client-supplied pass/fail results. Each evaluation records the exact default-branch base commit SHA used for comparison; merge acquires a repository-wide advisory lock, resolves the target again, and rejects the merge with a stale-evaluation conflict if that base commit changed. Only the latest evaluation for the current revision can satisfy the merge gate.

Set both `GIT_REPOSITORY_ROOT` and `EVIDENCE_ROOT` to enable revision, evaluation, evidence and merge operations. Configure the digest-pinned Docker evaluator to run the repository test suite rather than only the built-in diff check. If either is absent, the related routes return `503`; the API never fabricates a revision, evaluation, evidence artifact, review, or merge. Evidence files are stored with restrictive permissions and referenced by opaque content-addressed artifact URIs rather than exposing filesystem paths.

The PostgreSQL store owns organization-scoped changesets and repository metadata. Every state update uses an expected version; a concurrent update returns `409` and must be reloaded. The API enforces session identity, active organization membership, role checks, exact Origin, and session-bound CSRF for all writes.

## OIDC authentication

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

If OIDC configuration is absent or provider discovery fails, login returns `503`, protected routes remain unavailable, and `/readyz` remains `503`. A successful OIDC login creates or updates a local user by the immutable `(issuer, subject)` pair; it does not grant organization membership. An operator-controlled first-owner/bootstrap step is still required before the user can access tenant-scoped delivery resources.

## First-owner bootstrap (operator-only)

A successful OIDC login creates a local user but never grants organization access. Provision the first owner from a trusted operator environment with direct database access; there is no public bootstrap HTTP endpoint.

Set the exact issuer and immutable `sub` claim from the configured OIDC provider, then run:

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

Start the separate worker with `go run ./cmd/pipeline-worker` from the API module. Provide `DATABASE_URL` and `PIPELINE_CHECK_IMAGE` in its environment. Use a dedicated Docker runner with a preloaded operator-controlled digest-pinned image containing `/usr/bin/timeout` and an executable `/usr/local/bin/agentforge-check`. The `container/check@v1` step invokes that check as an unprivileged user with a read-only filesystem, disabled networking and a two-minute time limit. Each worker claims one step at a time. A lost lease becomes available after 30 seconds. Three abandoned attempts fail the run. Run events include the first 8 KiB of the check’s stdout, the result and the actor. Checks receive no host credentials or user-supplied environment.

For a container step, `secretParams` lists up to 16 parameters of type `secretRef`. Bind each parameter in the visual editor or the workflow JSON. Provision UTF-8 values of up to 16 KiB through an external secret manager mounted read-only at `PIPELINE_SECRETS_DIR/{organizationID}/{pipelineID}/{stepID}/{name}` on the worker. The operator controls all directories. Missing or inaccessible references fail the step. The check receives a JSON object on stdin keyed by parameter name. The worker discards output from checks that receive secrets and records a `secret_refs_requested` event for the attempt. The API and run snapshot contain reference names only.
