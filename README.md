# AgentForge

**Agent-native Source Control & Verified Change Platform** — React + TypeScript frontend and Go modular-monolith API.

## Architecture and development

- [Target architecture](docs/architecture/overview.md)
- [Architecture decisions](docs/architecture/decisions.md)
- [Native Git Hosting architecture](docs/architecture/native-git-hosting.md)
- [Native Git Hosting API and data model](docs/architecture/native-git-api-and-data-model.md)
- [Native Git Hosting delivery plan](docs/plans/native-git-hosting.md)
- [Development roadmap](docs/plans/development-roadmap.md)
- [Deployment architecture](docs/deployment/architecture.md)

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
- **pre-push**: Checks Go code formatting in `backend/api` using `gofmt` to prevent pushing unformatted code

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
