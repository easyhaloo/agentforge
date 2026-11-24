# Architecture Decision Records

## ADR-001: Monorepo with independently deployable applications

- Status: Accepted
- Decision: Keep React frontend and Go backend in one Git repository, under `apps/web` and `backend/api`.
- Context: Frontend and backend changes often need coordinated API-contract updates, while their build and release lifecycles should remain independent.
- Consequences:
  - Shared review, issues and versioned API contracts.
  - Path-aware CI and independent deployments are required.
  - Frontend migration from the repository root must be incremental.

## ADR-002: Go modular monolith

- Status: Accepted
- Decision: Start with one Go API service organized by business modules and explicit dependency boundaries.
- Context: The product domain is still being established; microservices would add network, deployment and data-consistency costs before boundaries are proven.
- Consequences:
  - Modules own their business rules and data access.
  - Cross-module operations use explicit interfaces or events.
  - Modules may be extracted later based on measured needs, not speculation.

## ADR-003: React is presentation; Go owns authoritative business state

- Status: Accepted
- Decision: React owns presentation and transient UI state. Go owns authorization, business transitions, persistence, evaluation coordination and merge eligibility.
- Consequences:
  - LocalStorage fixtures are transitional only.
  - The UI must not decide authoritative approval, evidence validity or merge eligibility.
  - API errors and state are the source of truth.

## ADR-004: REST + OpenAPI; SSE for progress

- Status: Accepted
- Decision: Use versioned REST APIs under `/api/v1`, OpenAPI as the contract, and SSE for long-running progress notifications.
- Consequences:
  - No initial GraphQL/gRPC requirement.
  - SSE events do not replace persisted API state.
  - Generated or contract-checked frontend types are required.

## ADR-005: PostgreSQL as initial system of record

- Status: Accepted
- Decision: Use PostgreSQL for business records and durable execution metadata; add object storage for large artifacts.
- Consequences:
  - Avoid adding Redis/message brokers until a concrete requirement exists.
  - Module data ownership must be enforced in code.

## ADR-006: Isolated execution workers

- Status: Accepted
- Decision: Long-running Agent, Git and evaluation work runs outside API request handlers in isolated execution workers.
- Consequences:
  - Execution records, lifecycle, logs and cancellation are durable.
  - Untrusted code requires resource and credential isolation.
  - The initial worker design should remain small and evolvable.

## ADR-007: Independent frontend and backend deployment

- Status: Accepted
- Decision: Keep frontend on Cloudflare Workers Static Assets and deploy Go API independently to a Go-capable runtime.
- Consequences:
  - Cloudflare Worker deployment must use static assets configuration, not Pages deployment commands.
  - Backend health, secrets, database and rollback are managed independently.
  - Browser API base URL is public configuration only; secrets never enter the frontend bundle.

## ADR-008: Scoped URL routing

- Status: Accepted
- Decision: Navigation state lives in the URL. The web app uses a React Router data router with one route table, `apps/web/src/app/routes.tsx`, as the only place that declares routes. Pages backed by the real API are organization-scoped under `/orgs/:org/...`. Mock and fixture pages stay flat, so they remain browsable without a session, and move under `/orgs/:org` only when a real backend capability replaces them.
  - `:org` is an organization handle: the organization's `slug`, or its `id`. Resolution mirrors the server: an exact `id` match wins, otherwise the slug matches case-insensitively; no match means "not found". The literal handle `current` is a client-side alias for the selected organization. Once the account is known the client replaces it (history `replace`, query string and hash preserved) with the organization's own handle, so a shared URL does not contain `current`.
  - The client builds handles as `slug || id`: frontend and backend deploy independently, so it falls back to `id` while the API does not return `slug`. `current` is reserved for the alias, so an organization whose slug is `current` is addressed by its `id`.
  - `/api/*` and `/auth/*` are backend paths on the same origin (reverse proxy) and are never client routes. The SSO entry is a plain `<a href="/auth/oidc/login">`.
  - Any other path renders a not-found state inside the shell. Pages build links only through `shared/routing`.

| Sidebar label | Path | Page |
|---|---|---|
| Overview | `/` | Overview (mock) |
| Projects | `/projects` | Resource workspace (mock) |
| Repositories | `/orgs/:org/repositories` | Repository directory (live API) |
| Repositories | `/orgs/:org/repositories/new` | Repository create form (live API, label reused, no duplicate sidebar item) |
| | `/orgs/:org/repositories/:owner/:repo` | Repository code browser |
| | `/orgs/:org/repositories/:owner/:repo/{issues,pulls,actions,settings}` | Repository sections |
| | `/orgs/:org/repositories/:owner/:repo/settings/rulesets` | Rulesets for native Git pushes (live settings API) |
| | `/orgs/:org/repositories/:owner/:repo/settings/{branches,tags,git-tokens,actions}` | Other repository settings panels |
| | `/orgs/:org/repositories/:owner/:repo/branches` | Redirects to the Branches settings panel |
| | `/orgs/:org/repositories/:owner/:repo/issues/new/choose` | Choose a repository issue template |
| | `/orgs/:org/repositories/:owner/:repo/issues/new` | Create new issue |
| | `/orgs/:org/repositories/:owner/:repo/issues/:number` | Issue detail |
| | `/orgs/:org/repositories/:owner/:repo/pulls` | Pull request list |
| | `/orgs/:org/repositories/:owner/:repo/pulls/new` | Compare and create pull request |
| | `/orgs/:org/repositories/:owner/:repo/pulls/:id` | Pull request detail (conversation tab) |
| | `/orgs/:org/repositories/:owner/:repo/pulls/:id/{commits,checks,files}` | Pull request tabs |
| | `/orgs/:org/repositories/:repositorySlug` | Legacy repository view with a link to the canonical Issues section |
| Issues | `/orgs/:org/issues` | Issues across the current organization, with links to repository issue details (live API) |
| Inbox | `/orgs/:org/notifications` | Signed-in organization member’s notification inbox (live API) |
| Workspaces | `/workspaces` | Resource workspace (mock) |
| Stacks | `/stacks` | Delivery flow (mock) |
| Self-healing | `/self-healing` | Delivery flow (mock) |
| Memory | `/memory` | Resource workspace (mock) |
| CI / CD | `/pipelines` | Resource workspace (mock) |
| Security | `/security` | Resource workspace (mock) |
| Governance | `/governance` | Resource workspace (mock) |
| Cost & Usage | `/usage` | Resource workspace (mock) |
| Settings | `/settings` | Personal settings |
| Saved replies | `/settings/saved-replies` | Account-scoped saved replies (live API) |
| UI Components | `/dev/ui` | UI showcase |
| Changesets | `/orgs/:org/changesets` | Changeset workspace (live API) |
| Trails | `/orgs/:org/trails` | Changeset workspace (alias) |
| Review | `/orgs/:org/review` | Changeset workspace (alias) |
| Eval | `/orgs/:org/eval` | Changeset workspace (alias) |
| Organization | `/orgs/:org/settings` | Organization management (live API) |
| (anything else) | `*` | Not found, inside the shell |

- Consequences:
  - Every page is linkable, and refresh, Back and Forward work. Humans and agents can construct URLs the way they do for GitHub or GitLab views.
  - The Cloudflare Worker already serves `index.html` for unknown paths (`not_found_handling: single-page-application`), so deep links need no server change. `/api/*` and `/auth/*` must reach the backend, not the asset fallback.
  - Trails, Review and Eval are aliases of the changeset workspace until they get their own pages.
  - Pull requests are repository-scoped views over Changesets with additional metadata (base/source branches, draft state, comments). They follow GitHub's URL pattern: `pulls` section, `pulls/new` for compare/create, `pulls/:id` for detail with conversation/commits/checks/files tabs.
  - A mock page that graduates to a real capability changes URL, from flat to organization-scoped.
  - Adding or changing a URL means updating `app/routes.tsx`, `app/navigation.ts`, the route table tests and this ADR together.
  - Browser tests run against the real entry and deep links instead of a separate harness page.

## ADR-009: First-party CI/CD workflow and integration platform

- Status: Proposed
- Decision: Build a first-party, organization-scoped CI/CD workflow product inside the existing Go modular monolith. Keep GitHub Actions as the CI system for the AgentForge repository itself; do not conflate repository CI with user-managed pipelines.
- Context: AgentForge needs reusable custom workflows, typed run parameters, durable execution, conflict detection, ordered multi-branch integration builds and safe promotion. Existing repository, Changeset, Revision, Evaluation, Review and Merge Gate capabilities should remain authoritative owners of their invariants.
- Decision details:
  - Persist canonical versioned workflow definitions as validated JSON; visual editing is the primary UX and YAML import/export is an interoperability feature.
  - Introduce pipeline, execution and integration module boundaries incrementally; extend the existing Git adapter through explicit ports.
  - Use PostgreSQL for workflow state, run metadata and initial durable task scheduling. Use isolated worker processes/containers for all untrusted repository execution.
  - Pin target and source refs to immutable commit SHAs at run creation. Build and test the exact ordered integration candidate.
  - Use Git merge simulation for conflict diagnostics, but require a real isolated candidate build for application validation.
  - Promotion is separate from candidate creation and requires current policy/evidence/approval plus expected-target-SHA concurrency protection. A moved target makes the candidate stale and requires rebuild/revalidation.
  - Add a per-repository/target-branch merge queue only after candidate provenance and safe promotion are implemented.
  - Do not add Redis, Kafka, Temporal or Kubernetes as initial mandatory dependencies.
- Consequences:
  - Workflow version, run, task, integration candidate and approval provenance must be persisted and auditable.
  - Secrets are references, never plaintext in definitions, API responses or run snapshots.
  - At-least-once task delivery requires idempotent task/step behavior and lease recovery.
  - The UI must distinguish mergeability, build/test success, gate eligibility and actual promotion.
  - Implementation proceeds according to `docs/plans/cicd-development-plan.md`; this ADR does not imply implementation is complete.

## ADR-010: Native AgentForge Git hosting

- Status: Accepted
- Decision: AgentForge is an independent Git hosting platform. It owns repository lifecycle, Git object storage, refs, Git transport, authentication, authorization, push policy and repository browsing. GitHub/GitLab integrations are not dependencies for core repository operations.
- Context: Repository and Changeset workflows require an authoritative source-control system. Delegating Git authority to another hosting service would make AgentForge a dependent integration rather than an independent platform.
- Consequences:
  - Reuse Git's native object format and standard Git client protocol; do not reimplement packfiles or Git wire protocol.
  - PostgreSQL owns repository metadata, tenant permissions, policy and durable event records. Git repositories own canonical Git objects and refs.
  - Initial storage is one bare repository per AgentForge repository on a durable server-controlled filesystem volume. This is an MVP deployment choice, not a horizontal-scaling claim.
  - Smart HTTP uses a maintained Git protocol implementation behind a tightly controlled Go gateway, subject to CGI isolation and interoperability/security tests.
  - Git commands run through a centralized bounded command runner with trusted storage keys, argument arrays, controlled environment, timeouts and output limits.
  - Browser reads are authorized by repository and pinned full commit SHA; blob resolution is commit+path, not an arbitrary SHA endpoint.
  - Push policy runs before ref acceptance; successful ref updates publish durable post-receive outbox events for CI, indexing, Changeset and Trail consumers.
  - Revision, evaluation, evidence, review and merge remain native AgentForge concepts bound to immutable Git commit IDs.
  - SSH, Git LFS, forks, search and horizontally scalable storage are later phases.
  - See [Native Git Hosting Architecture](native-git-hosting.md), [API and Data Model](native-git-api-and-data-model.md), and [Delivery Plan](../plans/native-git-hosting.md).

## ADR-011: Git-compatible storage scaling before alternative SCM storage

- Status: Accepted
- Decision: Evolve the first-party Git hosting engine using Git-compatible storage and protocol semantics first. Adopt Pando-inspired techniques incrementally: per-ref concurrency control, immutable pack/object reuse, fetch negotiation and caching, background compaction, bounded streaming and protocol conformance testing.
- Context: AgentForge must remain usable by standard Git clients and preserve Git commit identities, signatures and interoperability. Replacing the storage model before product requirements and operational scale are measured would create migration and compatibility risk.
- Consequences:
  - Git remains the canonical interoperable representation in the initial phases; Git commit SHA is never conflated with an AgentForge Changeset or Revision ID.
  - Ref updates use compare-and-swap against an expected old object ID. Independent refs may progress concurrently; competing updates to one ref are serialized/rejected safely.
  - Object/pack data is immutable after publication. Pack reuse and compaction are storage optimizations and must not change reachable Git object identity.
  - Fetch optimizations must preserve Git negotiation semantics and authorization boundaries. Cache keys include repository identity and relevant visibility/policy context.
  - Protocol v2 and packfile-URI-like transfer optimizations are enabled only after client interoperability tests.
  - Start with a local bare-repository adapter and explicit storage ports. Do not claim distributed scaling until shared-storage/sharding, locking, crash recovery and integrity behavior are proven.
  - Add deterministic concurrency tests for ref races, interrupted pushes, pack publication and reconciliation before introducing more complex storage topology.

## ADR-012: Server-side Source Control API and rebuildable derived data

- Status: Accepted
- Decision: Provide server-side source-control operations for Agents and CI, while keeping Git as the canonical data model initially. Add a versioned, rebuildable Derived Data layer for graph, blame, path history and search rather than requiring clients to clone full repositories for every query.
- Context: Anthropic's Scion demonstrates the value of always-online clients, server-side source-control RPCs, bounded local workspaces and derived indexes. Its Changeset-WAL storage model is a much larger compatibility break and is not required to obtain these API and workflow benefits.
- Consequences:
  - Provide bounded server operations for changeset metadata, diff, merge-base, history, blame, tree, blob and integration preview, all pinned to immutable Git object IDs.
  - Derived records are keyed by repository, commit/object identity, derivation kind and algorithm version. They are disposable projections, never the sole source of truth, and can be recomputed.
  - Support eager or lazy derivation according to query frequency and cost. Use asynchronous workers for expensive indexing; persist status and retry metadata.
  - Authorization is checked before resolving or returning objects. A known blob SHA is not an authorization credential; path-level ACLs apply before content access.
  - Agents and CI may use server APIs without a full checkout. Sparse and virtualized workspaces are later optimizations, not prerequisites for the API.
  - Keep REST/OpenAPI as the initial public contract. Internal interfaces may be transport-neutral, but do not introduce gRPC or a new RPC protocol without measured need.

## ADR-013: Scion-style Changeset storage is a future, separately versioned backend

- Status: Accepted
- Decision: Do not implement a Scion-style Changeset WAL / content-addressed Blob backend in the initial delivery. Preserve a future adapter boundary and evaluate it only when measured repository size, checkout traffic, write contention or storage cost justify a second data model.
- Context: Scion replaces Git's core storage and client assumptions with server-created Changesets, first-parent changed-file logs, blob pointers and derived graph/index data. Anthropic explicitly describes it as a purpose-built internal system, not a drop-in general Git replacement.
- Consequences:
  - The initial canonical store remains Git-native. No dual-write of all commits into a speculative WAL.
  - If a future backend is approved, define stable repository/changeset/blob IDs, parent and merge semantics, import/export fidelity, signature preservation, ref mapping, audit provenance and rollback before migration.
  - Git commit SHA and any future Changeset ID are distinct typed identifiers with explicit mapping/provenance; never compare or substitute them.
  - Any migration is staged and verifiable: freeze or serialize writes per repository, export/import, verify graph/content, shadow-read, compare results, switch authority, retain rollback data, then resume.
  - Keep the initial SourceControlStore interface narrow and driven by real use cases. Do not prematurely implement two complete storage engines.
  - Revisit only with measured thresholds and a dedicated ADR amendment; no Scion compatibility or performance claim is implied.


## ADR-014: First-class Repository Preview

- Status: Accepted
- Decision: Build a zero-clone repository browsing and preview experience on the native Source Control API. Every view resolves a moving ref to a full immutable commit SHA and serves repository content through authorization-aware, bounded APIs.
- Context: Humans and Agents need to inspect repositories without provisioning a workspace or downloading the full Git object graph. Repository Preview should work independently from WebIDE and must not execute repository content.
- Consequences:
  - Provide repository landing, refs, tree, README/Markdown, source files, commit history, diffs, compare and blame as incremental capabilities over the Git adapter.
  - Canonical links pin the commit SHA; branch/tag names are display context and are resolved at the boundary.
  - Repository and directory ACL are enforced before object resolution, cache lookup or content delivery.
  - Markdown is sanitized, external resource loading is controlled, binary/large files are streamed or downloaded with limits, and repository HTML/JS is never executed on the application origin.
  - Immutable commit-scoped responses may be cached only with repository/visibility-aware keys and authorization checks.
  - Preview is read-only; edits and execution require an explicit WebIDE workspace.
  - See [Repository Preview and WebIDE](repository-preview-and-webide.md).

## ADR-015: Extensible WebIDE with isolated workspaces and extension hosts

- Status: Accepted
- Decision: Provide a browser-based WebIDE as a client of AgentForge's server-managed, isolated workspace APIs. Start with a Monaco-based editor shell and a versioned AgentForge Extension SDK; do not promise full VS Code Marketplace compatibility.
- Context: Users and Agents need browser-based editing, diagnostics, task execution and live previews. A fixed editor would constrain product growth, while unrestricted plugins or running code in the API/browser origin would create unacceptable security risks.
- Consequences:
  - A workspace is created from a pinned base commit and has durable lifecycle, ownership, expiry, resource limits and audit identity.
  - File writes use optimistic version checks. Diff and Changeset handoff use the existing Source Control and Changeset lifecycle; the IDE does not invent an alternate commit/review/merge path.
  - Terminal, build, test and preview execute only in isolated workers/runtimes, never in HTTP handlers or the trusted frontend origin.
  - Web extensions run in a sandboxed Worker/iframe through a versioned message-based RPC bridge. Server-side extensions run in isolated workers.
  - Extensions declare contributions and deny-by-default capabilities; organization grants, per-call authorization, short-lived tokens, package integrity, audit and revocation are mandatory.
  - First-party and organization-private extensions precede a curated registry. Open VSX or VS Code extension compatibility is a later, explicitly scoped project.
  - Preview applications use isolated origins, strict CSP, bounded egress and short-lived access; preview URLs are not public by default.
  - See [Repository Preview and WebIDE](repository-preview-and-webide.md).
## ADR-010: Repository source viewer and WebIDE engines

- Status: Accepted
- Decision: Use Shiki tokenization for read-only repository source browsing and Monaco Editor for the WebIDE. Keep unified diff and secure Markdown rendering independent. Share language metadata, not editor instances or rendering lifecycles.
- Context: The current repository viewer uses a small regex tokenizer and the WebIDE uses a shared textarea. Repository browsing needs fast progressive read-only rendering; WebIDE needs a complete editing surface and extension points.
- Consequences:
  - Shiki grammars are loaded on demand; tokens are rendered as escaped React text. Unknown/large files retain plain-text fallback.
  - Monaco is lazy-loaded only on the WebIDE route and remains behind an AgentForge adapter.
  - Existing Changeset-only write-back, commit/blob SHA concurrency, and dirty-buffer protections remain authoritative.
  - Diff parsing and Markdown URL/image security remain independent.
  - Tree-sitter structural navigation is deferred until measured requirements justify it.
  - Details and phased acceptance criteria live in `docs/architecture/repository-code-viewer-and-webide.md`.
