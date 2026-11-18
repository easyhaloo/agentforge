# Native Git Hosting Delivery Plan

## Goal

Deliver AgentForge as an independent Git hosting platform with native repository storage, Git CLI interoperability, repository browsing and native Changeset/Revision integration. This is not a GitHub/GitLab synchronization project.

## Delivery principles

- Keep the Go modular monolith and /api/v1 OpenAPI contract.
- Preserve ADR-008 organization-scoped frontend routes.
- Use Git native object format and a maintained protocol implementation; do not reimplement packfiles or wire protocol.
- PostgreSQL owns tenant metadata, identity, permissions, policy and durable events; Git owns objects and refs.
- Do not claim hosting complete until standard Git clients can clone, fetch and push against AgentForge.
- Ship tested vertical slices. No production deployment is required for CI/documentation phases.

## Phase 0 — Architecture correction (this change)

- [x] Establish AgentForge as authoritative independent Git hosting platform.
- [x] Reject GitHub/GitLab Provider and external-hosting dependency for core repository operations.
- [x] Define bare repository storage, Smart HTTP, authorization, push policy, browsing and data ownership.
- [x] Define immutable commit pinning for Revision and file browsing.
- [x] Define phased delivery and acceptance tests.

Acceptance: architecture and roadmap consistently describe native Git hosting; no external provider is required.

## Phase 1 — Native repository lifecycle and read engine (P0)

- [ ] Audit repository registration, local Git adapter and migrations; remove external-provider semantics.
- [ ] Define lifecycle states and idempotent provisioning/compensation.
- [ ] Implement storage-root configuration, generated storage keys and bare repository create/open/quarantine.
- [ ] Implement centralized safe Git command runner.
- [ ] Implement refs, branches, tags, commit history, tree and blob reads with authorization and immutable commit pinning.
- [ ] Add migrations for lifecycle/storage metadata and indexes.
- [ ] Add integration tests with temporary bare repositories and PostgreSQL.

Acceptance: create a repository through API; resolve refs and browse a pinned commit; reject cross-tenant access, invalid refs, traversal, oversized output and timed-out commands; recover partial provisioning.

## Phase 2 — Git Smart HTTP and access control (P1)

- [ ] Implement Smart HTTP gateway for upload-pack and receive-pack using maintained git-http-backend.
- [ ] Implement scoped, revocable HTTPS tokens and repository read/write ACL.
- [ ] Enforce public/private clone policy and private-repository non-disclosure.
- [ ] Implement pre-receive branch policy and bounded push quotas.
- [ ] Persist post-receive events in durable outbox; add idempotent consumers and reconciliation.
- [ ] Add interoperability tests using real git clone, fetch and push, including negative authorization/policy cases.

Acceptance: standard Git client can clone/fetch/push over HTTPS; unauthorized and protected pushes are rejected; event processing recovers after interruption; secrets never appear in logs, URLs or process arguments.

## Phase 3 — Repository Explorer and preview (P2)

- [ ] Add organization-scoped repository detail, tree, commit and file routes.
- [ ] Add typed frontend API client and explorer page.
- [ ] Add CodeMirror 6 read-only source viewer.
- [ ] Add sanitized Markdown, image, JSON, CSV, PDF and binary fallback viewers.
- [ ] Add size limits, download behavior, loading/empty/error states and accessible navigation.
- [ ] Add browser tests for deep links, ref changes and permission failures.

Acceptance: browse AgentForge-hosted repositories without cloning; every view is pinned to a commit SHA and private content is authorized server-side.

## Phase 4 — Diff, branch policy and Changeset integration (P2/P3)

- [ ] Add compare and bounded unified diff APIs.
- [ ] Add branch protection and force-push controls.
- [ ] Bind Changeset Revision to immutable commit SHA and record base SHA.
- [ ] Add native review comments and decisions against exact Revision.
- [ ] Integrate merge gate/ref updates with Git Hosting Engine policy and audit.
- [ ] Ensure Trail records accepted push, revision, evaluation, review and merge transitions.

Acceptance: Changeset review and merge are native AgentForge capabilities over AgentForge-hosted refs; stale evidence/reviews cannot authorize a newer Revision.

## Phase 5 — Production-grade repository operations (P3/P4)

- [ ] Git LFS pointer and object storage protocol.
- [ ] SSH transport with managed keys and revocation.
- [ ] Fork/network model if product demand validates it.
- [ ] Repository search/indexing and incremental index recovery.
- [ ] Quotas, abuse controls, integrity checks, backup/restore and storage migration.
- [ ] Decide multi-node storage topology or repository sharding based on measured load.

Acceptance: restore drills, integrity checks, quotas and alerts are demonstrated; topology is documented and tested before horizontal scaling.

## Cross-cutting test strategy

- Unit: ref/path validation, permission policy, token hashing, lifecycle state machine and event idempotency.
- Integration: temporary bare repositories, command runner, hooks, migrations and outbox recovery.
- Protocol: supported Git CLI versions execute clone/fetch/push over Smart HTTP.
- Security: tenant isolation, private repo non-disclosure, command injection, malicious Git config, symlink/submodule handling, oversized packs, process exhaustion and credential redaction.
- Browser: deep links, immutable commit navigation, safe file rendering and unauthorized states.
- Operations: crash recovery during provisioning/push, backup restore, git fsck and storage migration verification.

## Explicit first-release non-goals

- GitHub/GitLab Provider or synchronization layer.
- Reimplementation of Git object format, pkt-line or packfile algorithms.
- GitHub-compatible API surface.
- Running repository code in API process.
- Multi-region active-active writes or object-store-mounted bare repositories without proven Git locking semantics.
- Online IDE/collaborative editing; CodeMirror is read-only preview initially.
