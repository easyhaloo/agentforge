# AgentForge

**Agent-native Source Control & Verified Change Platform** — React + TypeScript frontend and Go modular-monolith API.

## Documentation

### For AI Agents
- **[AGENTS.md](AGENTS.md)** — Mandatory AI entry guide: core principles, domain rules, workflow (all AI tools)
- **[CLAUDE.md](CLAUDE.md)** — Claude Code-specific configuration

### For Developers
- **[Frontend Development](docs/development/frontend.md)** — React, Feature-Sliced architecture, routing, i18n, domain invariants
- **[Backend Development](docs/development/backend.md)** — Go standards, API design, database, testing
- **[Testing Guide](docs/testing/setup.md)** — Test environment setup (Docker, DATABASE_URL)
- **[E2E Testing Guide](docs/testing/e2e.md)** — Playwright E2E tests, execution strategy, debugging
- **[Contributing Guide](CONTRIBUTING.md)** — How to contribute (to be created)

### Architecture and Planning
- **[Architecture Overview](docs/architecture/overview.md)** — System design and target architecture
- **[Architecture Decisions](docs/architecture/decisions.md)** — ADRs and design rationale
- **[Native Git Hosting Architecture](docs/architecture/native-git-hosting.md)** — Native Git hosting design
- **[Native Git Hosting API](docs/architecture/native-git-api-and-data-model.md)** — API and data model
- **[Native Git Hosting Plan](docs/plans/native-git-hosting.md)** — Delivery plan
- **[Development Roadmap](docs/plans/development-roadmap.md)** — Feature roadmap and phases

### Operations
- **[Backend API Guide](backend/api/README.md)** — API deployment, configuration, operations
- **[Deployment Architecture](docs/deployment/architecture.md)** — Deployment guides
- **[Pipeline Runners](docs/operations/pipeline-runners.md)** — CI/CD operations

## Development

Requirements: Node.js 22+ and Go 1.25+.

```bash
npm install
npm run dev
npm test
npm run build

cd backend/api
go test ./...
go run ./cmd/server
```

The frontend lives in `apps/web`; root npm scripts delegate to the workspace. The Go API lives in `backend/api` and listens on `PORT` (default `8080`).

### Git Hooks

Git hooks are managed by [Husky](https://typicode.github.io/husky/) and are automatically installed when you run `npm install`. The following hooks are configured:

- **pre-commit**: Runs `npm test` to ensure tests pass before committing
- **pre-push**: Comprehensive quality checks before pushing:
  1. Documentation placement validation
  2. Go code formatting (`gofmt`)
  3. Go unit/integration tests
  4. Frontend unit tests (Vitest)
  5. Frontend build check (TypeScript + Vite)
  6. E2E tests (Playwright) - skip with `SKIP_E2E=1`

To bypass a hook temporarily (not recommended), use `git commit --no-verify` or `git push --no-verify`.

## Frontend architecture

```text
apps/web/src/
  app/          # Application composition, route table (routes.tsx), navigation and shell state
  features/     # User-facing feature modules
  domain/       # Framework-independent business rules
  entities/     # Domain entity models
  pages/        # Route-level page composition
  shared/       # Reusable hooks, utilities and URL routing helpers
  styles/       # Global design system and styles
```

Navigation state lives in the URL (React Router). `app/routes.tsx` is the single route table: mock pages are flat (`/projects`, `/stacks`, `/dev/ui`, ...), and pages backed by the real API are organization-scoped (`/orgs/:org/changesets`, `/orgs/:org/settings`, ...), where `:org` is the organization's slug or id and `current` means the selected organization. See ADR-008 in `docs/architecture/decisions.md`.

## Implementation boundaries

The Go API already provides organization-scoped repository registration, local Git ref resolution and merge operations, plus the persisted Changeset, Evaluation, Evidence and Review lifecycle. These capabilities require an operator-provisioned local Git repository root and configured PostgreSQL/evidence dependencies; see [the API guide](backend/api/README.md).

Some flat resource workspaces still use seeded mock data and browser LocalStorage. Durable remote CI execution, Agent Runtime sessions, hosted preview environments, Repository Preview rich inspection (history/diff/blame), WebIDE workspaces and the extension platform are separate delivery phases and must not be inferred from the existing repository catalog or Changeset APIs.
