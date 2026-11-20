# AgentForge Development Plan

## Goal

Evolve the React prototype into an Agent-native Source Control & Verified Change Platform using a monorepo and Go modular-monolith backend.

## Current baseline

- Frontend: React 19 + TypeScript + Vite in the independent `apps/web` package (no npm workspaces).
- Existing behavior: seeded fixtures and browser LocalStorage.
- Backend: Go modular-monolith API with PostgreSQL migrations, tenant-scoped Changeset persistence, OIDC identity boundary, and operator bootstrap tooling.
- API contract: versioned REST/OpenAPI contract at `contracts/openapi/openapi.yaml`.
- Cloudflare project: Worker with a `workers.dev` route, not Pages.
- `apps/web/wrangler.jsonc` points Worker Static Assets to `apps/web/dist`; Cloudflare Workers Builds must use `apps/web` as its build root.

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
- OIDC callback verifies active membership or consumes a pending single-use invitation whose email matches the provider-verified email before issuing a session; arbitrary first logins cannot create authenticated application sessions.
- Organization invitations are tenant-scoped, expire after seven days, persist only token hashes, support listing/revocation, and are consumed atomically during verified OIDC callback.
- `GET /api/v1/me` returns the authenticated profile and only active organization memberships, providing the server-authoritative organization selector context for the frontend.
- The web shell now loads `/api/v1/me`, switches among active organizations, and exposes real member, invitation and audit views using the tenant-scoped APIs; member role/status changes and invitation lifecycle operations are sent to the backend.
- Web mutations include the readable session-bound CSRF cookie in `X-CSRF-Token`; the HttpOnly session credential is never read by JavaScript or persisted in browser storage. The web API uses same-origin paths so host-only `__Host-` cookies remain correctly scoped.
- Organization Owners/Admins can read paginated membership audit history; invitation acceptance is recorded with actor/target attribution.
- Operator-only, transactionally serialized first-owner bootstrap CLI; first login never silently grants organization membership.
- Local PostgreSQL Compose setup, OIDC configuration, and bootstrap documentation.

Remaining:
- Add an approved transactional email provider/queue for invitation delivery; current API returns the one-time invitation URL to the authorized administrator.
- Centralize role and membership authorization policy outside HTTP handlers; current membership mutation transactions re-check actor role and enforce owner/admin boundaries.
- Configure the production OIDC provider and registered callback URL through deployment secrets/environment; verify end-to-end login in the deployed environment.
- Add cross-tenant authorization tests for every read/write path, callback-level rejection tests for unprovisioned identities, and session expiry/rotation tests.
- Commit reproducible Go module checksums and add explicit migration upgrade tests.

Acceptance: unauthenticated requests are rejected; every organization route is backed by a verified active membership; SQL remains tenant-scoped; readiness reflects PostgreSQL and identity dependencies; security and integration tests pass.

## Phase 3 — Core delivery domain

Status: **Implemented in the single Changeset lifecycle delivery branch; pending CI and review before merge.**

Implemented in this delivery:
- Organization-scoped repository catalog and migration 006; registration is restricted to Owners/Admins. The current local Git implementation is an early internal storage adapter, not a complete Git hosting transport.
- Initial local Git adapter and repository lifecycle integration. Refs resolve to immutable commit SHA/parent SHA; merge performs a no-fast-forward merge into the registered default branch. This is not a GitHub/GitLab Provider integration and does not yet imply clone/fetch/push over Smart HTTP.
- Revision changes stale prior evidence and reviews; API mutation operations are serialized with PostgreSQL advisory locks and optimistic version checks.
- Server-side evaluation interface. Default evaluator performs Git patch integrity checks; optional digest-pinned Docker evaluator runs an operator-configured test command in a network-isolated, read-only, non-root, resource-limited container.
- Evaluation reports are persisted as content-addressed artifacts with SHA-256 provenance and revision/evaluation linkage.
- Review assignment verifies the reviewer is an active member of the same organization and excludes the author. Only the assigned reviewer can decide.
- Merge gate revalidates a current passing evaluation, active evidence and approved current-revision review before Git mutation. The actual Git commit SHA is persisted. Retry behavior recognizes an already-integrated revision.
- Changeset audit events record each lifecycle transition; complete authenticated API workflow tests cover registration through merge and negative gate/authorization cases.

Known adapter boundary:
- The existing local Git adapter is an early internal storage implementation, not a complete AgentForge Git Hosting Engine. Smart HTTP clone/fetch/push, transport authentication, receive hooks, durable post-receive events and repository browsing remain separate deliverables.
- AgentForge is the authoritative Git hosting platform; GitHub/GitLab Provider or synchronization layers are explicitly out of scope.
- Without the optional Docker evaluator configuration, the default evaluator checks Git diff integrity only; it does not claim to run the repository's complete test suite.
- The lifecycle API is synchronous; durable background job scheduling, cancellation and streamed execution events remain Phase 5 work.

Acceptance: one end-to-end lifecycle passes against a real local Git repository and PostgreSQL; tenant isolation, stale evidence/review rejection, reviewer authorization, merge preconditions and persisted commit identity are covered by CI.

## Phase 4 — Frontend API migration

Status: **In progress** — account/organization APIs and the full Changeset lifecycle UI are connected to backend APIs; remaining product surfaces still contain fixtures.

Implemented:
- Typed identity and organization API client with credentialed same-origin requests, CSRF mutation headers and structured HTTP errors.
- Server-authoritative account profile and organization selector from `GET /api/v1/me`.
- Organization member list, role/status update, suspension/reactivation and removal UI.
- Invitation creation, one-time URL display/copy, listing and revocation UI.
- Membership audit history UI and role-aware management affordances.
- Changesets page now registers organization repositories, creates persisted changesets, resolves Git revisions, runs trusted evaluation, displays evidence provenance, assigns/decides reviews, and requests server-gated merges. All lifecycle state is read from backend APIs.
- Explicit signed-out, unauthorized and API-unavailable states; session revocation on sign-out.

Remaining:
- Migrate the remaining Trails, Stacks, Eval and Review workspaces to the same persistent lifecycle APIs and remove the remaining delivery fixtures/LocalStorage. Add browser E2E tests with PostgreSQL, a provisioned local Git repository, and the pinned sandbox evaluator image.
- Add SSE progress subscriptions after durable execution events exist.
- Add end-to-end browser tests against a configured OIDC provider and PostgreSQL environment.

Acceptance: backend is source of truth for delivery; state survives refresh and cross-browser use; organization and identity mutations remain server-authorized.

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

## Phase 7 — CI/CD workflow platform

The detailed product scope, architecture and implementation sequence are defined in:
- [CI/CD architecture](../architecture/cicd-architecture.md)
- [CI/CD product design](../product/cicd-product-design.md)
- [CI/CD development plan](cicd-development-plan.md)

The CI/CD plan adds versioned custom workflows, typed parameters, durable worker execution, Git conflict detection, ordered multi-branch integration builds, safe candidate promotion and a merge queue. It complements the Changeset lifecycle and does not replace GitHub Actions for AgentForge repository CI.

Delivery order within this initiative:
1. Pipeline domain, immutable versions, schema validation and tenant-scoped APIs.
2. Durable execution tasks, worker leases, isolation, logs, cancellation and retry.
3. Visual authoring, parameters, secret references and triggers.
4. Git source pinning, single/multi-branch conflict reports and integration candidates.
5. Candidate build/test and safe promotion with expected-target-SHA checks.
6. Per-target merge queue and train rebuild semantics.
7. Remote providers, artifact storage and production hardening.

Acceptance: see the phase-specific measurable criteria in `docs/plans/cicd-development-plan.md`. Do not mark any capability complete until implementation and CI demonstrate it.


## Native Git Hosting workstream

The approved target, data model and phased acceptance criteria are documented in:
- [Native Git Hosting Architecture](../architecture/native-git-hosting.md)
- [Native Git Hosting API and Data Model](../architecture/native-git-api-and-data-model.md)
- [Native Git Hosting Delivery Plan](native-git-hosting.md)

The workstream supersedes any earlier proposal that treated GitHub/GitLab as repository providers. Existing local Git code is reusable implementation material, but must be audited against the native hosting security, lifecycle and protocol requirements before it is considered production-ready.


## Source Control scaling and Agent-native APIs

The Native Git Hosting workstream now follows the decisions in [Source Control Evolution](../architecture/source-control-evolution.md) and ADR-010 through ADR-013:

1. Keep Git-native storage and standard Git client compatibility as the first canonical implementation.
2. Implement server-side diff, merge-base, history, tree/blob and integration-preview operations over the Git adapter; all reads are authorized and pinned to immutable commit IDs.
3. Add versioned, rebuildable Derived Data for commit graph, path history and blame, with eager/lazy computation and canonical Git fallback.
4. Optimize measured Git bottlenecks using per-ref CAS, immutable pack reuse, bounded streaming, fetch caching and background compaction.
5. Add sparse/virtualized workspaces only after server-side APIs and usage telemetry demonstrate the need.
6. Evaluate a Scion-style Changeset WAL only through a separate ADR backed by measured workload, import/export fidelity, shadow-read parity and rollback proof.

Do not implement two complete storage engines or dual-write speculative Changeset logs in the initial delivery. Performance figures published by OpenAI or Anthropic are reference context, not AgentForge targets or guarantees.


## Repository Preview and extensible WebIDE

The target architecture and acceptance criteria are defined in [Repository Preview and WebIDE](../architecture/repository-preview-and-webide.md), with ADR-014 and ADR-015.

Delivery is deliberately separated into independently useful increments:

1. Repository Preview: commit-pinned tree/blob/README/history/diff APIs, read-only browser, sanitization, pagination and repository/directory authorization.
2. Rich inspection: blame, compare, stable permalinks and derived-data acceleration.
3. WebIDE shell: isolated workspace lifecycle, Monaco editor, explorer, tabs, search, diff and Changeset handoff.
4. Execution/preview: isolated task workers, terminal/build/test, SSE and sandboxed preview origins.
5. Extension SDK: versioned manifest, sandboxed extension host, capability grants, first-party extensions and organization-private distribution.
6. Ecosystem: curated registry and optional Open VSX compatibility only after isolation, signing and revocation controls are proven.

Repository Preview must not require a workspace. WebIDE must not bypass Changeset, review, CI or merge gates. Do not execute untrusted repository code in the API process or trusted browser origin. These stages are planned, not marked implemented.
