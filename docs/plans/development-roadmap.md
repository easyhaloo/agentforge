# AgentForge Development Plan

## Goal

Evolve the React prototype into an Agent-native Source Control & Verified Change Platform using a monorepo and Go modular-monolith backend.

## Current baseline

- Frontend: React 19 + TypeScript + Vite in the `apps/web` npm workspace.
- Existing behavior: seeded fixtures and browser LocalStorage.
- Backend: Go modular-monolith API with PostgreSQL migrations, tenant-scoped Changeset persistence, OIDC identity boundary, and operator bootstrap tooling.
- API contract: versioned REST/OpenAPI contract at `contracts/openapi/openapi.yaml`.
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
Tracking: [PR #21](https://github.com/easyhaloo/agentforge/pull/21) · [PR #24](https://github.com/easyhaloo/agentforge/pull/24) · [PR #26](https://github.com/easyhaloo/agentforge/pull/26) · [PR #28](https://github.com/easyhaloo/agentforge/pull/28) · [PR #31](https://github.com/easyhaloo/agentforge/pull/31) · [PR #32](https://github.com/easyhaloo/agentforge/pull/32)  
Status: **In progress** — persistence, session security, OIDC login, and first-owner bootstrap are merged; organization lifecycle and production provider configuration remain.

Implemented:
- PostgreSQL schema for organizations, users, external identities, memberships, sessions, and organization-owned Changesets.
- Versioned, transactional SQL migration ledger with an advisory lock.
- Validated runtime configuration, including port range and PostgreSQL URL validation.
- Cryptographic request IDs propagated through response headers and request context.
- Organization-scoped Changeset repository methods and SQL predicates.
- Organization-scoped API routes requiring a trusted `PrincipalResolver`.
- Role checks at the HTTP boundary; unknown roles and viewer writes are denied.
- Database + identity-aware readiness. The server reports `not_ready` until OIDC configuration is complete and provider discovery succeeds.
- Opaque 256-bit session and CSRF credentials; only SHA-256 token hashes are persisted.
- PostgreSQL session creation, expiry, revocation, CSRF binding, and organization-scoped principal resolution.
- Host-only Secure session/CSRF cookie definitions (`HttpOnly` session cookie), exact-origin credentialed CORS, and session-bound CSRF enforcement for state-changing API requests.
- `APP_ORIGIN` validation; HTTPS is required outside loopback development.
- OIDC Authorization Code + PKCE with provider discovery/JWKS validation, state/nonce/PKCE, one-time authorization transactions, ID-token validation, and session rotation.
- External identity upsert by immutable `(issuer, subject)`; unverified email is never used as an identity key.
- OIDC login, callback, and CSRF-protected logout routes.
- OIDC callback verifies that the local user has an active membership in an active organization before issuing a session; arbitrary first logins cannot create authenticated application sessions.
- Operator-only, transactionally serialized first-owner bootstrap CLI; first login never silently grants organization membership.
- Local PostgreSQL Compose setup, OIDC configuration, and bootstrap documentation.

Remaining:
- Implement organization membership lifecycle: list members, invitations, role changes, suspension/removal, and audit attribution.
- Centralize role and membership authorization policy outside HTTP handlers.
- Configure the production OIDC provider and registered callback URL through deployment secrets/environment; verify end-to-end login in the deployed environment.
- Add cross-tenant authorization tests for every read/write path, callback-level rejection tests for unprovisioned identities, and session expiry/rotation tests.
- Commit reproducible Go module checksums and add explicit migration upgrade tests.

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