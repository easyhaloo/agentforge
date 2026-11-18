# AgentForge Architecture

## Status

- Architecture style: **Monorepo + Go modular monolith**.
- Frontend: React 19, TypeScript, Vite.
- Backend: Go HTTP API, introduced incrementally.
- API contract: REST + OpenAPI.
- Realtime delivery: Server-Sent Events (SSE), where needed.
- Primary database: PostgreSQL.
- Frontend hosting: Cloudflare Workers Static Assets.
- Backend hosting: an independently deployed Go service.
- Execution: isolated workers/workspaces; never run untrusted repository code inside an API request handler.

This document describes the approved target architecture. It does not claim that the Go backend, database, Git Smart HTTP transport, or execution workers already exist.

## 1. Product boundary

AgentForge is an independent Git hosting platform, on the same product category level as GitHub and GitLab. AgentForge owns Git repository storage, refs, transport, authentication, authorization and browsing. GitHub/GitLab are not upstream sources or provider dependencies for core repository operations. See [ADR-009](decisions.md#adr-009-native-git-hosting) and [Native Git Hosting Architecture](native-git-hosting.md).


AgentForge is an **Agent-native Source Control & Verified Change Platform**. It coordinates changes and verifies delivery; it is not itself an Agent Runtime and must not be reduced to an AI-themed Git hosting interface.

The product vocabulary is normative:

- **Git Commit**: immutable Git object identified by its full commit SHA.
- **Changeset**: stable product-level unit of proposed change.
- **Revision**: an iteration of a Changeset; it does not replace the Changeset identity.
- **Evidence**: output produced by evaluating one exact Revision.
- **Review decision**: a decision made against one exact Revision.
- **Trail**: traceable sequence of work, decisions, and evidence associated with delivery.

Evidence and approval for an older Revision must never be treated as valid for a newer Revision.

## 2. Repository organization

The repository is a monorepo with independently buildable and deployable frontend and backend applications.

```text
agentforge/
├── apps/
│   └── web/                 # React + TypeScript + Vite
├── backend/
│   └── api/                 # Go modular monolith
│       ├── cmd/server/
│       ├── internal/
│       │   ├── platform/    # config, database, HTTP, logging, security
│       │   └── modules/     # business modules
│       ├── migrations/
│       ├── go.mod
│       └── go.sum
├── contracts/
│   └── openapi/             # versioned API contract
├── deployments/             # deployment-specific configuration
├── docs/
│   ├── architecture/
│   ├── plans/
│   └── deployment/
└── .github/workflows/
```

Migration from the current root-level Vite application into `apps/web` is incremental. Do not move the entire frontend until the baseline build, tests, and deployment path are understood and can be kept green.

## 3. System context

```text
Browser
  └── React Web (Cloudflare Workers Static Assets)
        ├── HTTPS REST ───────────────┐
        └── SSE (long-running updates)│
                                      ▼
                              Go API Server
                               ├── Application use cases
                               ├── Domain modules
                               ├── PostgreSQL
                               ├── Native Git Hosting Engine
                               └── Execution scheduler
                                      │
                                      ▼
                              Isolated execution workers
                               ├── Git operations
                               ├── Evaluation / CI
                               └── Agent integrations
```

The Go API is the authoritative owner of business state. The React application owns presentation and transient UI state, not the canonical delivery lifecycle.

## 4. Backend architecture

Use a **modular monolith**: one Go API deployment initially, with explicit module boundaries and dependency direction. Do not split modules into microservices without measured operational or scaling reasons.

Suggested business modules:

| Module | Responsibility |
| --- | --- |
| identity | Authentication, principals, credentials and authorization context |
| organization | Organizations and memberships |
| repository | Native AgentForge repository metadata, lifecycle and access policy |
| git | Bare repository lifecycle, safe Git command boundary, refs and object access |
| gittransport | Git Smart HTTP protocol gateway and bounded process execution |
| gitpolicy | Push rules, branch protection and repository quotas |
| git-events | Durable post-receive events, idempotent consumers and reconciliation |
| changeset | Changeset lifecycle and invariants |
| revision | Revision identity, ancestry and commit association |
| evaluation | Evaluation lifecycle and result aggregation |
| evidence | Revision-bound evidence and artifact references |
| review | Review decisions and revision validity |
| merge | Merge preconditions and merge execution coordination |
| trail | Append-oriented delivery and audit history |
| execution | Durable execution records, scheduling and worker coordination |

Do not create empty packages for every suggested module at the outset. Introduce a module when its first real use case is implemented.

### Internal module shape

Use domain/application/transport/infrastructure separation where it clarifies ownership:

- `domain`: entities, value objects, invariants and domain services; no HTTP or database dependencies.
- `application`: use cases, transaction boundaries and orchestration.
- `transport`: HTTP handlers and request/response mapping.
- `infrastructure`: PostgreSQL and external-system adapters implementing owned interfaces.

Keep abstractions local to the module that owns them. Avoid generic service/repository layers without a concrete use case.

### Dependency rules

- Transport calls application use cases.
- Application depends on domain and explicit ports.
- Infrastructure implements ports and is wired at the composition root.
- Domain does not import HTTP, SQL drivers, Git CLI, cloud SDKs, or other modules' infrastructure.
- Cross-module operations use explicit application interfaces or domain events; do not write another module's tables directly.

## 5. Core delivery lifecycle

The principal workflow is:

`Repository → Changeset → Revision → Evaluation → Evidence → Review → Merge → Trail`

Important invariants:

1. A Changeset has a stable identity across Revisions.
2. Every Evaluation targets one exact Revision.
3. Evidence is bound to the Revision that produced it.
4. A Review decision is bound to the Revision reviewed.
5. Creating a newer Revision invalidates the applicability of older Revision evidence and review decisions to the current Revision.
6. Merge rechecks current Revision, required evidence, review policy, repository state and authorization immediately before execution.
7. Trail records meaningful lifecycle transitions and actor/automation attribution.

The exact state machines and transition tables must be documented alongside their implementation before they are treated as stable API behavior.

## 6. Frontend architecture

The frontend remains feature-oriented:

- `app`: bootstrap, providers, routing and shell composition.
- `pages`: route-level composition.
- `features`: user-intent workflows such as create Changeset, run Evaluation, request Review and merge.
- `entities`: reusable business entity types and UI only when shared by multiple modules.
- `shared`: business-agnostic UI, API transport, utilities and configuration.
- `domain`: framework-independent client-side rules that are safe and useful for presentation; backend remains authoritative.

Navigation state lives in the URL: `app/routes.tsx` is the single route table, pages backed by the real API are organization-scoped under `/orgs/:org/...`, and mock pages stay flat (ADR-008).

The frontend must not duplicate authoritative authorization, state transitions, merge eligibility, or evidence validity decisions.

Use a typed API client generated from or checked against the OpenAPI contract. Keep server state in a query/cache layer and local transient UI state in React. Use SSE for progress notifications; query the API for authoritative final state.

## 7. API contract

- REST over HTTPS, versioned under `/api/v1`.
- OpenAPI is the shared source of truth for request/response schemas.
- JSON for normal request and response bodies.
- RFC 9457-style problem details with stable application error codes.
- Request IDs for traceability.
- SSE for long-running execution events; SSE events are notifications, not the authoritative state store.
- Use idempotency keys for retryable commands where duplicate execution would be harmful.

Do not introduce GraphQL or gRPC in the initial implementation without a demonstrated need.

## 8. Persistence

PostgreSQL is the initial system of record for business state and durable execution metadata.

Object storage is used for larger artifacts such as logs, test reports and evidence files, and later Git LFS payloads; relational records store metadata and immutable references. Native Git objects and refs live in AgentForge-managed bare repositories, not PostgreSQL.

Do not introduce Redis or a separate message broker until concrete concurrency, throughput, or coordination requirements justify the operational cost. The first durable scheduler can use PostgreSQL-backed records and transactional claiming if that is sufficient.

Each business module owns its data access boundary. Cross-module reads should use explicit query/application interfaces; cross-module writes must go through the owning module.

## 9. Execution isolation

The API server must not execute untrusted repository code or long-running Agent processes inside HTTP handlers.

Execution is represented durably, scheduled, and run by isolated workers with:

- per-execution workspace isolation;
- bounded CPU, memory, disk and runtime;
- timeout, cancellation and retry semantics;
- controlled secrets and credentials;
- durable logs and result metadata;
- explicit execution identity and audit attribution.

Start with a small worker process boundary. Adopt a workflow engine only when durable multi-step orchestration requirements justify it.

## 10. Deployment

- Frontend: Cloudflare Workers Static Assets, independently built and deployed from the frontend application.
- Backend: independently deployed Go HTTP service on a Go/container-capable runtime.
- Database: managed PostgreSQL for production.
- Artifacts: S3-compatible object storage when evidence size/lifecycle requires it.
- Frontend and backend have separate configuration, health checks, releases and rollback paths.

The current Cloudflare project is a **Worker**, not a Pages project. Its build must use a Worker configuration that serves Vite's `dist/` as static assets. Do not use `wrangler pages deploy` for this project.

## 11. CI/CD principles

- CI validates only affected applications plus shared contracts/configuration.
- Frontend and backend deploy independently.
- OpenAPI changes trigger contract validation and generated-client consistency checks.
- Production deployment is gated on relevant tests and build checks.
- Avoid two competing production deployment mechanisms for the same application.
- Secrets are stored in deployment/GitHub secret stores, never in source or frontend-exposed variables.

## 12. Explicit non-goals for the initial foundation

- Microservices.
- Kubernetes unless deployment scale requires it.
- Redis or Kafka without demonstrated need.
- A generalized plugin framework before real integration boundaries exist.
- Full Agent Runtime implementation inside the API process.
- Big-bang frontend rewrite or domain redesign.
