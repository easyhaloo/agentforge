# AgentForge

**Agent-native Source Control & Verified Change Platform** — React + TypeScript frontend and Go modular-monolith API.

## Architecture and development

- [Target architecture](docs/architecture/overview.md)
- [Architecture decisions](docs/architecture/decisions.md)
- [Development roadmap](docs/plans/development-roadmap.md)
- [Deployment architecture](docs/deployment/architecture.md)

## Development

Requirements: Node.js 22+ and Go 1.25+.

```bash
npm install
npm run dev
npm test
npm run build
npm run deploy:dry-run

cd backend/api
go test ./...
go run ./cmd/server
```

The frontend lives in `apps/web`; root npm scripts delegate to the workspace. The Go API lives in `backend/api` and listens on `PORT` (default `8080`).

## Frontend architecture

```text
apps/web/src/
  app/          # Application composition, navigation and shell state
  features/     # User-facing feature modules
  domain/       # Framework-independent business rules
  entities/     # Domain entity models
  pages/        # Route-level page composition
  shared/       # Reusable hooks and utilities
  styles/       # Global design system and styles
```

## Prototype boundaries

Seeded mock data and browser LocalStorage remain in the frontend prototype. Real Git operations, remote CI, Agent Runtime sessions, review notifications, merge operations and backend persistence are not implemented yet.