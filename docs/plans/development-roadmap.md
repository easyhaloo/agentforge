# AgentForge Development Plan

## Goal

Evolve the React prototype into an Agent-native Source Control & Verified Change Platform using a monorepo and Go modular-monolith backend.

## Current baseline

- Frontend: React 19 + TypeScript + Vite in the `apps/web` npm workspace.
- Existing behavior: seeded fixtures and browser LocalStorage.
- Backend: initial Go HTTP API under `backend/api`; no business modules or PostgreSQL schema yet.
- API contract: initial health/readiness OpenAPI contract at `contracts/openapi/openapi.yaml`.
- Cloudflare project: Worker with a `workers.dev` route, not Pages.
- Root `wrangler.jsonc` points Worker Static Assets to `apps/web/dist`; Cloudflare Workers Builds must retain repository root as build root.

## Delivery rules

1. Preserve current user-facing behavior during structural migration.
2. Keep `main` buildable at every phase.
3. Run relevant tests and builds; report only observed results.
4. Do not introduce empty packages or speculative infrastructure.
5. Do not implement all modules at once.
6. Review OpenAPI changes as API contract changes.
7. Deliver small, reviewable PRs.
8. Deploy frontend and backend independently.

## Phase 0 — Architecture baseline

Status: **Completed**.

## Phase 1 — Monorepo foundation

Priority: P0
Tracking: [Issue #5](https://github.com/easyhaloo/agentforge/issues/5) · [PR #19](https://github.com/easyhaloo/agentforge/pull/19)
Status: **Foundation merged** in [PR #19](https://github.com/easyhaloo/agentforge/pull/19).

Implemented and merged:
- Initialized the Go HTTP API with `/healthz`, `/readyz`, structured logs and graceful shutdown.
- Added endpoint tests and the initial health/readiness OpenAPI contract.
- Moved the React/Vite application into `apps/web` and introduced root npm workspace scripts.
- Retained the latest `main` resource-record models, resource workspace behavior, and Worker entrypoint while relocating the frontend.
- Configured Wrangler Worker Static Assets to serve `apps/web/dist`.
- Added path-aware CI for frontend tests/build and Worker dry-run, Go tests/build, and OpenAPI lint.

Remaining:
- Generate and commit a reproducible npm lockfile.
- Verify Cloudflare Workers Builds against the actual production project settings; Wrangler dry-run is not a production deployment.

Acceptance: frontend behavior is preserved; web, API and contract CI checks pass; Worker packaging is valid; no Pages deploy workflow, duplicate production deploy path or committed secrets.

## Phase 2 — Backend platform and persistence

Priority: P1  
Tracking: [PR #21](https://github.com/easyhaloo/agentforge/pull/21) · [PR #24](https://github.com/easyhaloo/agentforge/pull/24) · [PR #26](https://github.com/easyhaloo/agentforge/pull/26) · [PR #28](https://github.com/easyhaloo/agentforge/pull/28)  
Status: **In progress** — persistence and tenant-scope foundations are merged; production identity is not implemented.

Implemented:
- PostgreSQL schema for organizations, users, external identities, memberships, sessions, and organization-owned Changesets.
- Versioned, transactional SQL migration ledger with an advisory lock.
- Validated runtime configuration, including port range and PostgreSQL URL validation.
- Cryptographic request IDs propagated through response headers and request context.
- Organization-scoped Changeset repository methods and SQL predicates.
- Organization-scoped API routes requiring a trusted `PrincipalResolver`.
- Role checks at the HTTP boundary; unknown roles and viewer writes are denied.
- Database + identity-aware readiness. The production server intentionally remains `not_ready` until an OIDC-backed identity resolver is configured.
- Opaque 256-bit session and CSRF credentials; only SHA-256 token hashes are persisted.
- PostgreSQL session creation, expiry, revocation, CSRF binding, and organization-scoped principal resolution.
- Host-only Secure session/CSRF cookie definitions (`HttpOnly` session cookie), exact-origin credentialed CORS, and session-bound CSRF enforcement for state-changing API requests.
- `APP_ORIGIN` validation; HTTPS is required outside loopback development.
- Local PostgreSQL Compose setup and API startup documentation.

Remaining:
- Implement OIDC Authorization Code + PKCE, discovery/JWKS validation, state/nonce replay protection, login/callback/logout endpoints, and session rotation.
- Implement user/external identity upsert and organization membership lookup in the authentication flow.
- Add a safe operator-controlled first-owner/bootstrap path.
- Wire OIDC configuration into the production server and only report Ready after provider discovery and session identity are available.
- Add cross-tenant authorization tests for every read/write path and session lifecycle tests.
- Add committed Go module checksums and migration upgrade tests.

Acceptance: unauthenticated requests are rejected; every organization route is backed by a verified active membership; SQL remains tenant-scoped; readiness reflects PostgreSQL and identity dependencies; security and integration tests pass.

## Phase 3 — Core delivery domain

Implement repository metadata, Changeset, Revision, Evaluation, Revision-bound Evidence, Revision-bound Review, Merge and append-oriented Trail.

Acceptance: complete delivery workflow through APIs; stale evidence/review cannot authorize a newer Revision; merge revalidates all preconditions.

## Phase 4 — Frontend API migration

- Add typed API client from OpenAPI.
- Replace fixtures and LocalStorage business persistence incrementally.
- Add loading/error/retry states and SSE progress subscriptions.

Acceptance: backend is source of truth for delivery; state survives refresh and cross-browser use.

## Phase 5 — Execution subsystem

- Durable execution records and scheduler.
- Isolated worker and per-task workspace.
- Git/evaluation execution, artifacts, cancellation, timeout and retry.
- Bounded Agent adapter interface.

Acceptance: tasks survive API restarts; worker is isolated; execution lifecycle and immutable evidence are tested.

## Phase 6 — Production hardening

- Independent backend deployment and rollback.
- PostgreSQL backup/restore and object storage controls.
- Metrics, logs, traces, audit events, security controls and runbooks.

Acceptance: independent releases, demonstrated restore, operational health/alerting and production smoke tests.