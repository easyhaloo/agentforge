# Source Control Evolution: Pando and Scion-Inspired Design

## 1. Purpose and decision

This document translates two distinct source-control designs into an incremental AgentForge architecture:

- **Pando (OpenAI)** scales Git while retaining Git's object model and client compatibility.
- **Scion (Anthropic)** redesigns source control around server-created Changesets, content-addressed blobs, derived data and always-online clients.

They solve overlapping scale problems but are not interchangeable implementations. AgentForge adopts a **Git-compatible core with Scion-inspired server-side capabilities**. It does not attempt to reproduce either company's internal system wholesale.

This is a target architecture and delivery decision, not a claim that the listed capabilities are implemented.

## 2. Design comparison

| Concern | Pando-inspired direction | Scion-inspired direction | AgentForge decision |
|---|---|---|---|
| Canonical history | Git commits and objects | Server Changeset log | Git-native first |
| Client compatibility | Standard Git clients | Purpose-built daemon/RPC | Preserve Git CLI |
| Writes | Pack ingestion and ref updates | Server creates Changesets | Git receive-pack first |
| Concurrency | Independent refs can progress concurrently; same-ref updates coordinate | Changeset append separated from ref movement | Per-ref CAS; no global repository write lock |
| Storage | Immutable packs/objects, reuse and compaction | Changed-file WAL plus blob pointers | Git objects/packs; abstract storage boundary |
| Queries | Git protocol and server-side Git operations | Server-side history/diff/blame/merge APIs | Add server APIs over Git |
| Indexes | Git-derived indexes/caches | Rebuildable Derived Data | Versioned rebuildable indexes |
| Checkout | Negotiated object transfer | Sparse/virtualized workspaces | Full clone remains supported; sparse later |
| Scaling | Pack reuse, cache, compaction, streaming | Tiered caches, no full mirrors | Optimize from telemetry, not assumptions |

## 3. Target architecture

```text
Git CLI / IDE / Agent / CI
       | Git Smart HTTP       | Source Control REST API
       v                     v
Git Transport Gateway    Source Control API
       |                     |
       +----------+----------+
                  v
          Source Control Core
      +-----------+------------+
      | Repository / ACL / Ref |
      | Commit Graph / Diff    |
      | Merge / Blame / History|
      | Integration Preview   |
      +-----------+------------+
                  |
          Git Storage Adapter
                  |
       Bare Git repositories
       (objects, packs, refs)
                  |
        +---------+----------+
        |                    |
   Derived Data          Event Outbox
   (rebuildable)         (durable)
        |                    |
   Index workers       CI / Changeset /
   Cache tiers         Review / Trail
```

The Go modular monolith remains the control plane. Git repositories remain the canonical data plane. PostgreSQL owns tenant metadata, ACL, durable workflow state, ref-operation metadata where required, and outbox records. Git owns canonical Git objects and refs. Large artifacts and future LFS payloads use object storage.

Do not mount an arbitrary object store as a Git repository filesystem. Do not claim horizontal scalability from a local filesystem adapter.

## 4. Source Control Core boundaries

Introduce code only alongside a concrete vertical slice. The conceptual ownership is:

- `repository`: repository metadata, lifecycle and visibility.
- `git`: Git object/ref operations, safe command runner and storage adapter.
- `gittransport`: Smart HTTP protocol gateway and process supervision.
- `gitpolicy`: receive rules, branch protection and quotas.
- `sourcecontrol`: application-facing operations such as diff, merge-base, history and integration preview.
- `derived`: versioned, rebuildable indexes.
- `git-events`: durable push/ref events, idempotent consumers and reconciliation.

Do not create a parallel Changeset lifecycle. Existing Changeset, Revision, Evaluation, Evidence, Review, Merge and Trail modules remain authoritative for delivery workflow.

### 4.1 Storage port

Start with a narrow Git-native port:

- create/open/quarantine/delete repository storage;
- resolve refs and update refs with an expected-old-value check;
- read commit/tree/blob data;
- stream Git protocol operations;
- inspect and verify repository integrity.

The first adapter is a local bare Git repository. Any future distributed or alternative adapter must preserve explicit object identity and consistency contracts. Keep transport and storage abstractions separate.

## 5. Pando-inspired Git scaling

Adopt these techniques in order, only when measurements justify them:

1. **Per-ref concurrency.** A ref update compares the expected old object ID and atomically installs the new one. Independent refs do not require a repository-wide lock. Conflicting updates to one ref fail or retry against a new base.
2. **Immutable object publication.** Objects and packfiles are immutable after publication. Publish objects before making refs point to them. An interrupted push must never expose a ref to missing objects.
3. **Pack reuse.** Avoid regenerating or retransmitting objects already available to the receiver. Preserve Git's negotiation and reachability rules.
4. **Streaming and bounded processing.** Stream upload-pack/receive-pack with cancellation, quotas, resource bounds and backpressure. Do not buffer arbitrary packs in API memory.
5. **Fetch caching.** Cache only after authorization and scope cache keys by repository and policy/visibility context. Invalidate or version ref-dependent metadata safely.
6. **Compaction.** Run pack consolidation as a background maintenance task. It must preserve object reachability and be safe against concurrent readers/writers.
7. **Protocol conformance.** Test supported Git versions, protocol v0/v1 and v2 as enabled, shallow/deepen/filter capabilities only when explicitly supported, and interrupted network sessions.

Do not implement pkt-line, pack parsing, delta compression or pack generation from scratch. Prefer maintained Git protocol tooling and prove the CGI/process boundary is safe.

## 6. Scion-inspired server-side source control

The benefits of Scion that AgentForge can adopt without replacing Git are:

- Always-online server queries for diff, merge-base, history, blame, tree and blob.
- CI and Agents can ask questions without materializing a full working tree.
- Every operation pins moving refs to immutable commit IDs at the start.
- Sparse workspaces can materialize only requested paths.
- Virtualized/on-demand file access may be added after filesystem compatibility and developer experience are validated.
- Derived indexes can be computed eagerly for hot paths and lazily for cold paths.

Initial public API remains REST + OpenAPI. Candidate operations include:

| Operation | Input identity | Required behavior |
|---|---|---|
| Commit metadata | full commit ID | Return immutable metadata and parents |
| Diff | base/head commit IDs | Bounded diff with rename and binary metadata |
| Merge base | commit IDs | Return common ancestor or explicit none |
| History | commit ID + path/cursor | Paged path/commit history |
| Blame | commit ID + path/range | Line attribution tied to exact commit |
| Tree | commit ID + path | Paged directory entries |
| Blob | commit ID + path | Authorize path, resolve object, stream bounded content |
| Integration preview | pinned target + ordered source IDs | Conflict diagnostics and candidate provenance |

These APIs are capabilities over Git, not an alternate storage engine.

## 7. Derived Data model

Derived Data is a cache/index, never the source of truth.

Every derived record must include:

- repository identity;
- source commit/object identity;
- derivation kind;
- algorithm/schema version;
- content checksum or deterministic result identity;
- creation/update time and computation status.

Initial candidates:

- commit graph acceleration / ancestry;
- path history;
- file blame;
- changed-path summaries;
- search indexes;
- merge-base acceleration.

Rules:

1. Rebuild from canonical Git objects.
2. Version algorithms so a new implementation can coexist during migration.
3. Make jobs idempotent and retryable.
4. Support eager computation for hot paths and lazy computation for cold paths.
5. Never use an index result to bypass repository or directory authorization.
6. A missing or stale index must degrade to a bounded canonical Git query, not incorrect data.

## 8. Consistency and failure model

### Git object and ref consistency

- Git object IDs are immutable content identities.
- A ref update is atomic and guarded by the expected previous object ID.
- Object publication precedes ref publication.
- A failed ref CAS leaves unreachable objects eligible for later garbage collection; it must not corrupt a visible ref.
- Different refs may advance independently. There is no promise of a globally consistent snapshot across every ref.
- Multi-ref operations must declare whether they are atomic; never imply atomicity if the storage adapter cannot provide it.

### PostgreSQL and Git are not one transaction

Do not attempt a distributed transaction across PostgreSQL and Git storage. Define the authority for every field. After a successful Git ref update, write durable event state through an outbox/reconciliation design that can repair a crash between the Git mutation and event publication. Consumers are idempotent and keyed by repository/ref/object transition.

For operations requiring stronger recovery, persist an operation intent and expected old/new ref values before mutation, then reconcile actual Git state after restart. Do not claim exactly-once delivery.

### Changeset / Revision provenance

- Revision stores the full Git commit object ID and relevant base/parent identity.
- Evaluation, Evidence, Review and Merge bind to the exact Revision.
- CI integration candidates record ordered source commit IDs, target commit ID, merge strategy/version and resulting candidate commit ID.
- A moved target invalidates candidate freshness; promotion rechecks expected target SHA and gates.

## 9. Future alternative Changeset storage

A Scion-style backend would change core semantics:

- Changesets become server-generated append-only log entries.
- File changes are stored relative to a parent, with content-addressed blob pointers.
- Derived graph/path/blame data becomes central to normal queries.
- Clients rely on server APIs and daemon-managed bounded workspaces rather than full Git repositories.

This is not a drop-in Git adapter. Before considering it, AgentForge must specify and test:

- stable Changeset and Blob identifiers;
- merge and multi-parent semantics;
- import/export fidelity for Git trees, commits, tags and signatures;
- mapping between Git commit SHA and platform Changeset ID;
- path rename/copy semantics and first-parent versus full-DAG history;
- authorization and object reachability;
- audit provenance, backup/restore and rollback;
- shadow-read parity and migration cutover.

Never use a Git commit SHA as a Changeset ID or silently rewrite signed commit identity. The first release does not dual-write into a speculative WAL.

## 10. Security boundaries

- Authenticate and authorize before ref resolution, object reads, cache lookup or derived-data access.
- A known object/blob SHA is not proof of repository access.
- Directory ACL checks happen before content is returned.
- Git command execution uses a fixed binary, argument arrays, controlled environment, timeouts, output limits and process cancellation.
- Git hooks, filters, credential helpers, submodule URLs and repository-provided config must not execute in the API process.
- Worktrees are not security sandboxes. Build/test/Agent execution belongs in isolated workers.
- Cache keys and invalidation must not leak private repository content across tenants.
- Audit ref changes, force pushes, policy bypass and administrative storage operations.

## 11. Delivery sequence

| Stage | Scope | Exit criteria |
|---|---|---|
| A. Correct foundations | Git-native storage port, command runner, repository lifecycle and immutable commit pinning | Real local bare-repository integration tests and tenant/security tests |
| B. Native transport | Smart HTTP clone/fetch/push, scoped tokens, receive policy and outbox | Standard Git CLI interoperability and crash-recovery tests |
| C. Server-side queries | Diff, merge-base, history, tree/blob and integration preview | API/OpenAPI tests; all operations pinned and authorized |
| D. Derived Data | Versioned graph/path/blame indexes and worker lifecycle | Rebuild parity, idempotency and stale-index fallback |
| E. Git scaling | Per-ref CAS, pack reuse, bounded streaming, cache and compaction | Concurrency/load tests with integrity and latency metrics |
| F. Sparse workspaces | Sparse checkout and optional virtualized reads | Tool compatibility and measurable checkout reduction |
| G. Alternative backend evaluation | Scion-style Changeset WAL prototype only if metrics justify | Dedicated ADR, migration parity and rollback proof |

Stages may overlap only when dependency and test boundaries are explicit. Do not add speculative infrastructure or implement both storage engines in parallel.

## 12. Metrics that trigger optimization

Collect baselines before choosing scale work:

- clone/fetch/push p50/p95 latency and bytes transferred;
- pack generation CPU, pack reuse ratio and object duplication;
- ref update contention/retry rate by repository/ref;
- repository size, object count, pack count and compaction duration;
- Git command queue time, process concurrency and timeout rate;
- derived-data hit rate, staleness, compute cost and rebuild duration;
- CI checkout bytes/time and percentage of jobs that need no checkout;
- cache hit ratio segmented by visibility and repository;
- outbox lag and reconciliation repair count.

No Anthropic or OpenAI performance figures are AgentForge targets or guarantees. Optimize against AgentForge's own workload and cost measurements.

## 13. References

- OpenAI, *Scaling Git at OpenAI* (2026-11-02): https://openai.com/index/scaling-git-at-openai/
- Anthropic, *Redesigning source control at Anthropic* (2026-10-13; updated 2026-10-15): https://www.anthropic.com/research/redesigning-source-control
- Git protocol documentation: https://git-scm.com/docs/protocol-v2



## 14. Repository Preview and WebIDE

The read-only Repository Preview and editable WebIDE are separate clients of the Source Control Core. Preview resolves refs to immutable commit IDs and serves authorized, bounded tree/blob/history/diff content without creating a workspace. WebIDE creates an isolated workspace from a pinned commit and submits changes through the existing Changeset lifecycle.

The extension host is a versioned, capability-scoped API. Repository code and preview output are untrusted; neither executes in the trusted application origin or Go API process. See [Repository Preview and WebIDE](repository-preview-and-webide.md), ADR-014 and ADR-015.
