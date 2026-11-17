# AgentForge Development Plan

## Goal

Evolve the current React prototype into a working Agent-native Source Control & Verified Change Platform using the accepted Monorepo + Go modular monolith architecture.

This plan is execution-oriented. Work is delivered in small, reviewable increments; each phase has explicit exit criteria. Do not start later business modules before the foundation and contract are stable.

## Current baseline

- Existing application: root-level React 19 + TypeScript + Vite frontend.
- Existing behavior: seeded fixtures and browser LocalStorage.
- No Go backend, API server, PostgreSQL schema, or execution worker has been implemented in the repository baseline inspected for this plan.
- Cloudflare project in use is a Worker with a `workers.dev` route, not a Pages project.
- Existing `.github/workflows/deploy.yml` targets Cloudflare Pages and is inconsistent with the current Worker deployment. It must be corrected or removed before enabling competing production deploy paths.
- Existing `.github/workflows/ci.yml` runs frontend tests/build.

## Delivery rules

1. Preserve current user-facing behavior during structural migration.
2. Keep `main` buildable at every phase.
3. Run relevant tests and builds; report only observed results.
4. Do not introduce empty packages or speculative infrastructure.
5. Do not implement all modules at once.
6. OpenAPI changes are reviewed as product/API changes, not incidental generated output.
7. Each phase should be a small PR or coherent commit series with clear acceptance criteria.
8. Production deployments are independent: Cloudflare Workers for frontend, Go service for backend.

## Phase 0 — Architecture documentation and decision baseline

Status: **Completed** — architecture overview, ADRs, roadmap and deployment architecture are committed.

Deliverables:
- Architecture overview.
- Accepted ADRs.
- This implementation plan.
- Deployment guide corrected to match Workers Static Assets.

Exit criteria:
- Product terms and boundaries documented.
- Module responsibilities and dependency rules documented.
- Hosting model accurately describes current Cloudflare Worker and future Go backend.
- Plan and acceptance criteria committed.

## Phase 1 — Monorepo foundation

Priority: P0

Tracking: [Issue #5](https://github.com/easyhaloo/agentforge/issues/5)

Status: **In progress**. Initial inventory and tracking issue are established; implementation is gated on the current frontend CI baseline.

Scope:
- Move the existing Vite app to `apps/web` without changing behavior.
- Add root workspace scripts and lockfile strategy; keep frontend independently installable/buildable.
- Initialize `backend/api` with Go module, minimal HTTP server, configuration, structured logging, health/readiness endpoints and graceful shutdown.
- Add `contracts/openapi/openapi.yaml` with initial health and API metadata contract.
- Add local development instructions and environment examples without secrets.
- Add path-aware GitHub Actions CI for frontend, backend and contracts.
- Correct/remove the obsolete Pages deployment workflow. Keep exactly one frontend production deployment path: Cloudflare Workers Builds or a deliberately configured GitHub Actions Wrangler deployment, never both.

Acceptance criteria:
- Frontend behavior is unchanged; frontend tests and production build pass from its new location.
- Go server builds and tests; health endpoint returns success.
- OpenAPI validates.
- CI runs appropriate checks for frontend/backend/contracts and passes on PR.
- Cloudflare production deployment remains valid and no Pages command targets the Worker.
- No credentials are committed.

Out of scope:
- Authentication implementation.
- Business CRUD modules.
- PostgreSQL business schema.
- Agent execution.

## Phase 2 — Backend platform and persistence

Priority: P1

Scope:
- PostgreSQL connection lifecycle and migration tooling.
- Request IDs, structured logs, config validation and consistent Problem Details errors.
- Authentication principal and authorization middleware foundation.
- Transaction management and module ownership conventions.
- Local development composition for Go + PostgreSQL.

Acceptance criteria:
- Database migrations apply cleanly to an empty database.
- API starts and shuts down gracefully.
- Health and readiness distinguish process health from database readiness.
- Unauthorized requests are rejected consistently.
- Integration tests cover database and middleware behavior.

## Phase 3 — Core delivery domain

Priority: P1

Implement in dependency order:
1. Repository metadata and provider connection boundary.
2. Changeset lifecycle.
3. Revision lifecycle and commit association.
4. Evaluation records and Revision-bound Evidence.
5. Review decisions bound to exact Revision.
6. Merge preconditions and operation records.
7. Append-oriented Trail events.

Acceptance criteria:
- A complete Changeset → Revision → Evaluation → Evidence → Review → Merge → Trail workflow can be executed through APIs.
- New Revision makes older evidence/review inapplicable to current revision.
- Merge revalidates authorization, current revision, evidence, review and repository state.
- Domain invariants have unit tests; persistence and API behavior have integration tests.

## Phase 4 — Frontend API migration

Priority: P1

Scope:
- Add typed API client based on OpenAPI.
- Replace Overview and delivery fixtures with API queries incrementally.
- Replace LocalStorage business persistence with server mutations.
- Add loading, empty, error and retry states.
- Add SSE progress subscriptions for long-running operations.

Acceptance criteria:
- Main delivery flow uses backend as source of truth.
- Refreshing or using another browser preserves server-backed business state.
- Frontend does not make authoritative approval/merge decisions.
- Contract/client checks pass.

## Phase 5 — Execution subsystem

Priority: P2

Scope:
- Durable execution records and scheduler.
- Isolated worker process and per-task workspace.
- Git operations, evaluation/test execution and artifact capture.
- Cancellation, timeout, retries, logs and event publication.
- Agent integrations through a bounded adapter interface.

Acceptance criteria:
- Tasks survive API process restart.
- Worker execution is isolated from API process.
- Timeout/cancel/retry behavior is tested.
- Evidence links to exact Revision and immutable artifacts.
- Credentials are scoped and never exposed to browser clients.

## Phase 6 — Production hardening

Priority: P2

Scope:
- Independent Go backend deployment and rollback.
- Managed PostgreSQL backups and restore drill.
- Object storage lifecycle and access control.
- Observability: metrics, logs, traces and audit events.
- Rate limits, security headers, CORS, secret rotation and operational runbooks.
- End-to-end production smoke tests.

Acceptance criteria:
- Frontend and backend deploy independently.
- Database restore is demonstrated.
- Health/readiness and alerting are operational.
- Security and permission tests pass.
- Production workflow is documented and repeatable.

## Immediate next task

Start Phase 1 with a repository inventory and baseline checks. Before moving files, capture the current frontend test/build results and inspect all root-relative references, Vite configuration, GitHub workflows and deployment configuration. Then perform the smallest migration that preserves the current Cloudflare Worker build contract.
