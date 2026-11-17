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
