# AgentForge

**Agent-native Source Control & Verified Change Platform** — React + TypeScript frontend prototype.

## Architecture and development

- [Target architecture](docs/architecture/overview.md)
- [Architecture decisions](docs/architecture/decisions.md)
- [Development roadmap](docs/plans/development-roadmap.md)
- [Deployment architecture](docs/deployment/architecture.md)

The approved target is a monorepo with a React frontend and a Go modular-monolith backend. The current root-level React application remains a prototype; the Go backend is planned and is not yet implemented. See the architecture and roadmap documents for the migration sequence.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

## Frontend architecture

```text
src/
  app/                    # Application composition, navigation and shell state
  features/
    delivery/              # Changeset → Eval → Review → Trail workflow
    resources/             # Resource workspaces and per-resource configuration
  domain/delivery/         # Framework-independent revision and merge invariants
  shared/hooks/            # Reusable React hooks
  styles/                  # Global design system and application styles
  main.tsx                 # React bootstrap
```

### Dependency direction

- app composes features and owns cross-feature navigation.
- features own their UI, feature state and presentation.
- domain contains pure business rules and does not import React.
- shared contains reusable infrastructure and UI-independent utilities.
- features may depend on domain and shared; domain must not depend on features or app.

### React conventions

- Organize by feature ownership, not only by file type.
- Keep fixture/configuration data separate from feature rendering.
- Put reusable stateful behavior in custom hooks.
- Test domain invariants as pure functions.
- Isolate browser persistence behind a hook for later API replacement.
- Avoid global state libraries until server-state and cache needs justify them.

## Prototype boundaries

Seeded mock data and browser local storage only. No real Git operations, remote CI, Agent Runtime sessions, review notifications, merge operations or backend persistence.
