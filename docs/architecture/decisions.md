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
| Repositories | `/repositories` | Resource workspace (mock) |
| Workspaces | `/workspaces` | Resource workspace (mock) |
| Stacks | `/stacks` | Delivery flow (mock) |
| Self-healing | `/self-healing` | Delivery flow (mock) |
| Memory | `/memory` | Resource workspace (mock) |
| CI / CD | `/pipelines` | Resource workspace (mock) |
| Security | `/security` | Resource workspace (mock) |
| Governance | `/governance` | Resource workspace (mock) |
| Cost & Usage | `/usage` | Resource workspace (mock) |
| Settings | `/settings` | Resource workspace (mock) |
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
  - A mock page that graduates to a real capability changes URL, from flat to organization-scoped.
  - Adding or changing a URL means updating `app/routes.tsx`, `app/navigation.ts`, the route table tests and this ADR together.
  - Browser tests run against the real entry and deep links instead of a separate harness page.
