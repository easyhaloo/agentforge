# AgentForge CI/CD Development Plan

## Objective

Deliver a usable first-party CI/CD system with custom workflows, typed parameters, durable isolated execution, Git conflict detection, ordered multi-branch integration builds and safe promotion. This plan complements the existing platform roadmap; it does not replace the Changeset lifecycle or repository CI.

## Baseline and constraints

- Repository architecture is monorepo + Go modular monolith.
- Frontend is React/TypeScript/Vite under `apps/web`.
- Backend is Go under `backend/api`; PostgreSQL is the system of record.
- REST + OpenAPI is the API contract; SSE is progress notification.
- The repository currently has a flat `/pipelines` mock route.
- The existing repository/Changeset lifecycle includes repository registration, a local Git adapter, revision-bound evaluation/evidence/review and a merge gate. Reuse and extend those capabilities through owning application interfaces.
- The current delivery roadmap identifies durable background scheduling, cancellation and streamed execution events as remaining execution work.
- GitHub Actions continues to run CI for AgentForge's own source code. Product-managed workflows are separate.
- Do not claim a feature is implemented until code, tests and CI demonstrate it.

## Delivery principles

1. Keep `main` buildable; deliver through one reviewable MR/PR per coherent implementation tranche.
2. Implement vertical slices, not empty packages or UI-only mockups.
3. Preserve module ownership and organization isolation.
4. Pin all mutable Git refs to immutable commit SHAs at run creation.
5. Bind evidence and approval to exact workflow version and candidate/revision.
6. Never promote a candidate if its target base moved; rebuild and revalidate.
7. Never execute untrusted code inside HTTP handlers or a privileged API process.
8. Use PostgreSQL before introducing Redis/Kafka/Temporal; measure before adding infrastructure.
9. Every phase adds migrations, OpenAPI, tests, authorization and operational documentation as applicable.
10. Report test/build results from actual CI only.

## Phase 0 — Design and repository alignment

Deliverables:
- `docs/architecture/cicd-architecture.md`
- `docs/product/cicd-product-design.md`
- This implementation plan.
- Architecture overview and ADR updates.
- Explicit boundary between AgentForge repository CI and user pipelines.

Acceptance:
- Product concepts and module ownership are documented.
- Git promotion safety, source pinning, execution isolation and multi-branch semantics are explicit.
- No claim of implementation is made.

## Phase 1 — Pipeline domain and API foundation

Deliver:
- Organization-scoped Pipeline CRUD and lifecycle (draft, published, archived).
- Versioned JSON definition and server-side schema/semantic validation.
- Typed parameter schema and safe run-input validation.
- Initial OpenAPI contract and generated/checked frontend client.
- Migrations, role checks, audit events and tenant-isolation tests.
- Minimal UI for listing, editing structured workflow definitions and publishing.

Acceptance:
- Cross-tenant access is rejected.
- Published versions are immutable and checksummed.
- Invalid graphs (duplicate IDs, unknown capability, missing dependency, cycle, invalid parameter) are rejected.
- Runs always reference one published version.

## Phase 2 — Durable execution vertical slice

Deliver:
- Pipeline Run, Stage/Job/Step Run and durable Execution Task.
- PostgreSQL transactional task claiming, leases, heartbeat and reclaim.
- Worker process with task identity and bounded concurrency.
- One safe initial executor capability (e.g. a pinned, non-privileged container command).
- Logs, status, cancellation, timeout and retry semantics.
- SSE events backed by persisted state.
- Per-organization quotas and execution audit.

Acceptance:
- API restart and worker restart do not lose queued/running task state.
- Duplicate delivery does not duplicate a non-idempotent step.
- Cancellation and timeout terminate the execution and persist terminal state.
- Untrusted code runs only in isolated bounded environments.
- Logs are accessible only within the owning organization and secrets are redacted.

## Phase 3 — Workflow authoring and parameter UX

Deliver:
- Visual graph editor with stage/job/step hierarchy.
- Capability palette and typed node configuration.
- Dependency graph validation and accessible non-drag editing.
- Typed runtime parameters and redacted snapshots.
- Secret references and scoped injection.
- Manual/API triggers; webhook triggers with signature verification and deduplication.
- Templates and workflow cloning.

Acceptance:
- A user can build and publish a useful workflow without YAML.
- Runtime values are validated and immutable per run.
- Secret material never appears in API responses, definitions, snapshots or logs.
- Webhook retries do not create duplicate runs.

## Phase 4 — Git SCM integration and conflict detection

Deliver:
- Extend the existing Git provider port/local adapter; define provider capability negotiation.
- Resolve target and source refs to immutable SHAs.
- Single-source conflict simulation.
- Ordered multi-source merge simulation.
- Structured conflict reports with paths and pinned source/base SHAs.
- Isolated temporary candidate creation and cleanup.
- Explicit supported Git version behavior and integration tests.

Acceptance:
- Source branches are never mutated during detection.
- Repeated checks over the same pinned inputs produce reproducible results.
- Tests cover content conflict, add/add, delete/modify, rename, binary and submodule cases where supported.
- The report differentiates merge conflict from build/test failure.
- A full ordered train is tested; pairwise success is not treated as proof of combined success.

## Phase 5 — Integration build and safe promotion

Deliver:
- Integration Run and candidate provenance.
- Ordered source selection and configurable merge strategy (initially merge commit/no-ff; fast-forward only when valid).
- Run build/test capabilities against exact candidate SHA.
- Candidate freshness validation and target SHA compare-and-swap promotion.
- Existing Changeset Review/Merge Gate integration where the candidate contains Changesets.
- Promotion audit and failure recovery.

Acceptance:
- Candidate records target SHA, source SHAs, order, strategy, tree/commit SHA and workflow version.
- Any target movement invalidates the candidate and requires rebuild/revalidation.
- Failed checks, stale evidence, missing approval or denied authorization block promotion.
- Promotion never force-updates a protected branch.
- Resulting target commit SHA is persisted.

## Phase 6 — Merge queue and train validation

Deliver:
- Queue per repository + target branch.
- FIFO initial ordering and one promotion lock per target.
- Train candidates built from target + preceding entries + current entry.
- Rebuild/invalidate downstream candidates when queue predecessors change.
- Cancellation, failure removal and queue audit.
- UI for queue order, candidate freshness and rebuild state.

Acceptance:
- Concurrent workers cannot promote two entries against the same stale target.
- Downstream entries are never promoted from stale candidates.
- Queue recovery works after API/worker restart.
- Fairness and starvation behavior is documented before priority scheduling is enabled.

## Phase 7 — Provider, artifact and production hardening

Deliver:
- Remote GitHub/GitLab provider adapters after local adapter contract is stable.
- S3-compatible artifact/log storage and retention.
- Scheduled triggers, tags and Changeset events.
- Runner registration, capability policy and quotas.
- Metrics, alerting, runbooks, backup/restore and security review.

Acceptance:
- Provider contract tests cover ref resolution, merge simulation and safe promotion semantics.
- Artifact checksum and provenance are verified.
- Retention does not delete required audit metadata.
- Operational recovery and resource limits are demonstrated.

## Suggested implementation order

Implement phases 0 through 6 in sequence. Phase 7 can be split by provider and operational need. Within each phase, prefer a complete end-to-end vertical slice. Do not build a visual workflow canvas before the workflow schema and execution semantics are stable.

## Definition of Done

- Backend domain/application/transport/infrastructure boundaries are respected.
- OpenAPI and migrations are included where required.
- Organization authorization and cross-tenant tests are present.
- Unit, integration and relevant browser tests pass.
- CI status is green; failures are not waived by changing required checks.
- No secrets or generated build artifacts are committed.
- Documentation reflects actual shipped behavior.
- PR description lists scope, tests, risks, migrations and follow-up work.
