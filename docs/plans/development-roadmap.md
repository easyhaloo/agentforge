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
Tracking: [Issue #5](https://github.com/easyhaloo/agentforge/issues/5) · [PR #6](https://github.com/easyhaloo/agentforge/pull/6)
Status: **Implementation complete; final acceptance pending**.

Completed in PR #6:
- Initialized Go module and HTTP server with `/healthz`, `/readyz`, structured logs and graceful shutdown.
- Added endpoint tests and initial OpenAPI contract.
- Moved React/Vite frontend to `apps/web` and introduced root npm workspace scripts.
- Added root Wrangler Worker Static Assets configuration.
- Added path-aware CI jobs for frontend, backend and OpenAPI contract validation.
- Synchronized the latest `main` resource-record model and resource workspace changes into the `apps/web` workspace without restoring the old root `src/` tree.
- Added the Worker entry point, Static Assets binding and SPA fallback; CI now runs Wrangler dry-run packaging validation.
- Latest complete validation: [Actions run #44030681707](https://github.com/easyhaloo/agentforge/actions/runs/44030681707), head `30ae4fbdcf74c7d6ac1200a4143026a2f11bcf74`; frontend install/test/build/dry-run, Go test/build and OpenAPI lint all passed.

Remaining:
- Generate and commit a reproducible npm lockfile; `package-lock.json` is not yet present.
- Verify Cloudflare Workers Builds deploys the frontend from repository root to the production Worker.
- Add local development environment examples and complete API configuration validation.

Acceptance: frontend behavior preserved; all CI checks pass on the latest PR head; Worker deployment is verified in the target environment; no Pages deploy command or committed secrets.

## Phase 2 — Backend platform and persistence

- PostgreSQL lifecycle and migrations.
- Request IDs, config validation, Problem Details errors and authorization middleware.
- Transaction management and module ownership conventions.

Acceptance: migrations apply cleanly; readiness reflects dependencies; middleware and database integration tests pass.

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