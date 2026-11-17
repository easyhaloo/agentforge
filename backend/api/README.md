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
