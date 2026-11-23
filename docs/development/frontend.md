# Frontend Development Guide

**Read this when working on the React/TypeScript frontend in `apps/web`.**

See also: [Backend Development Guide](backend.md) | [AGENTS.md](../../AGENTS.md) | [Testing Guide](../testing/setup.md)

## Product Context

### Product Identity

AgentForge is an **Agent-native Source Control & Verified Change Platform**. It is not an Agent Runtime and should not be reduced to an AI-themed GitHub clone.

The frontend is currently a React + TypeScript prototype. Treat the existing product flows and domain distinctions as intentional unless a task explicitly changes them.

### Non-negotiable Domain Distinctions

These are binding constraints for all implementation work:

- **Git Commit**: an immutable Git object identified by its full commit SHA
- **Changeset**: a stable product-level unit of proposed change, with its own stable ID
- **Revision**: an iteration of a Changeset. A new Revision does not create a new Changeset identity
- **Evidence**: evaluation output bound to the exact Revision it evaluated
- **Review decision**: approval or requested changes bound to the exact Revision reviewed
- **Trail**: the traceable sequence of work and evidence associated with delivery

**Never:**
- Use a Changeset ID as a Git commit SHA or Revision ID
- Treat evidence or approval for an older Revision as valid for the current Revision

## Technology Stack

Use the existing stack unless a task explicitly approves a migration:

- **React 19** and React DOM
- **TypeScript 5** with strict mode
- **Vite 6** for build
- **Vitest 3** for testing
- **React Router** (`react-router-dom`, data router) for navigation
- **Lucide React** for icons
- **Recharts** for charts
- **react-i18next** for internationalization

### Common Commands

Run from the `apps/web` directory (it owns its own `package.json` and lockfile):

```bash
npm install           # Install dependencies
npm run dev          # Start dev server (port 5173)
npm test             # Run tests (Vitest)
npm run build        # TypeScript check + production build
npm run preview      # Preview production build
```

CI runs: install → test → build. Run tests and build before considering a change complete.

## React Router Rules (ADR-008)

Navigation state lives in the URL, not in `useState`.

### Single Route Table

`app/routes.tsx` is the **only place** that declares routes. Changing a URL or adding a page means updating:
1. `app/routes.tsx` (route definition)
2. `app/navigation.ts` (navigation menu)
3. Route tests (`app/routes.test.ts`)
4. `docs/architecture/decisions.md` (ADR-008)

### Organization-Scoped Routes

Pages backed by the real API are organization-scoped:
```
/orgs/:org/changesets
/orgs/:org/repositories
/orgs/:org/trails
/orgs/:org/review
/orgs/:org/eval
/orgs/:org/settings
```

`:org` is an organization handle (slug or id):
- Exact id match wins
- Slugs match case-insensitively
- `current` is a client-side alias for the selected organization (replaced on load)

### Flat Mock Routes

Mock and fixture pages stay flat (browsable without session):
```
/projects
/workspaces
/stacks
/self-healing
/memory
/pipelines
/security
/governance
/usage
/dev/ui
```

The overview (`/`) and personal settings (`/settings`) also require a session. Protected routes redirect to `/login` on a session check returning `401`, preserving the requested path, query, and fragment.

Move a page under `/orgs/:org` **only when** a real backend capability replaces its mock data.

### Route Implementation Rules

- **Backend paths**: `/api/*` and `/auth/*` are never client routes
- **Link building**: Pages must not import `app`. Use `shared/routing` (`orgPath`, `flatPaths`, `CURRENT_ORGANIZATION_HANDLE`)
- **Sidebar**: Built from `app/navigation.ts`
- **Page metadata**: `handle.label` in `app/routes.tsx` (read with `useMatches()`)
- **NavLink**: Use `end` prop so unknown paths highlight nothing
- **Error boundaries**: Pages sit under layout route with `errorElement`

## Frontend Architecture

### Target Module Organization (Feature-Sliced)

Migrate incrementally toward this structure **only when code is being changed**. Do not perform wholesale migrations.

```
apps/web/src/
  app/              # Application bootstrap, routing, layouts, shell
  pages/            # Route-level page composition
  features/         # User actions and workflows (clear user intent)
  entities/         # Reusable business-entity models and UI
  domain/           # Framework-independent business rules
  shared/           # Business-agnostic UI primitives, hooks, utilities
  styles/           # Global design tokens and styles
```

### Current Implementation

```
src/
  app/
    components/         # Shell-owned UI components
    routes.tsx          # The route table (only place declaring routes)
  pages/
    overview/           # Overview page, sections, view model
    resources/          # Resource workspace pages, config, sections
  features/
    delivery/           # Changeset delivery workflow
      hooks/
      ui/
      use-cases/
      workflow.ts
  entities/
    changeset/          # Changeset identity and type
    revision/           # Revision identity and type
    evidence/           # Revision-scoped evaluation evidence
    review/             # Revision-scoped review decision
    resource-records/   # Typed records for resource workspaces
  domain/
    delivery/           # Framework-independent delivery invariants
  shared/
    hooks/              # Reusable React hooks and persistence
    routing/            # Pure URL path builders
  styles/               # Global tokens, resets, styling
  main.tsx             # React bootstrap
```

### Layer Responsibilities

**app**
- Application composition, top-level navigation, global providers, shell
- Connects page and feature entry points
- Must not contain feature business logic or large page implementations

**pages**
- Navigation-level screen composition and page-specific view state
- Composes feature workflows and entity views
- Extract reusable user actions into `features` when they have clear workflow boundary

**features**
- User-facing workflows, feature components, feature-specific hooks
- May call domain functions and shared utilities
- Expose small public entry point to pages or app

**entities**
- Reusable business-entity models, API contracts, entity-owned UI
- Introduce only when real shared entity boundary exists

**domain**
- Framework-independent business types, identity rules, invariants, pure logic
- Must not import React, browser APIs, feature UI, or app modules
- Prefer deterministic pure functions testable without rendering

**shared**
- Genuinely reusable UI-independent hooks and infrastructure
- Not for feature-specific behavior used by two components in one feature

**styles**
- Global tokens, resets, typography, layout primitives
- Feature-specific styling should remain scoped and named

### Dependency Direction

**Allowed:**
```
app → pages/features/entities/shared
pages → features/entities/shared/domain
features → entities/shared/domain
domain → entities (type-level vocabulary only)
```

**Disallowed:**
- domain importing app, pages, features, React, or browser modules
- entities importing app, pages, features, or React
- shared importing business modules
- domain importing shared UI or React hooks
- circular dependencies between features
- feature modules reaching into another feature's private implementation

### Componentization Rules

- Componentization and module organization are separate concerns
- Split large pages into named components when sections have independent presentation, interaction, state, or semantic role
- Prefer colocating components with the page or feature that owns them
- Promote to `shared/ui` only when genuinely business-agnostic and reused across independent modules
- Keep component props explicit and narrow
- Extract repeated data/configuration from JSX into typed module-owned data files
- Avoid monolithic page components AND trivial one-line components
- Do not create global `components/`, `utils/`, `helpers/`, or `common/` dumping grounds

### File Naming

- **PascalCase**: React component files and exports
- **kebab-case**: TypeScript modules and directories
- **useXxx.ts**: Custom hooks
- **\*.test.ts(x)**: Tests

## React Best Practices

### Component Design

- Use function components and hooks
- Keep components focused on one cohesive responsibility
- Extract when component has distinct purpose, meaningful internal state, reusable presentation, or makes parent substantially easier to understand
- Keep page components as composition layers
- Keep render logic declarative (avoid deeply nested conditional JSX)

### State Management

- **Component state**: short-lived, local interaction state
- **Feature hooks**: workflows shared within one feature
- **URL state**: navigable, shareable filters/selections (when routing exists)
- **Server state**: data owned by backend (once API integration exists)
- **Shared application state**: only for genuinely cross-feature client state

Do not mirror derived values in state. Derive during render or use `useMemo` only when calculation cost or referential stability justifies it.

### Effects and Memoization

- Use effects for synchronizing with external systems, not for calculating values
- Every effect must have correct dependencies and cleanup where needed
- Do not use `useMemo`/`useCallback` mechanically
- Add them for measured expensive calculations, stable dependency contracts, or memoized child boundaries

### Keys and Immutability

- Use stable, meaningful keys for mapped elements
- Never use array indexes as keys when items can be inserted, removed, or reordered
- Do not mutate props, state, arrays, or objects (use immutable updates)

### Other Rules

- Do not define stateful component types inside another component (causes remounts)
- Use controlled inputs when UI must reflect application state
- Validate user input at the boundary
- Use semantic HTML, accessible labels, keyboard operation, visible focus, appropriate dialog behavior
- Avoid unnecessary prop drilling (prefer composition and feature-level hooks before global state)

## TypeScript

- Keep strict mode enabled
- Avoid `any`. Use explicit types, discriminated unions, or `unknown` with narrowing
- Use type-only imports where applicable
- Give exported functions and domain structures clear types
- Prefer small functions with one reason to change
- Use names describing domain intent (avoid vague names: `data`, `item`, `handler`)
- Keep imports at top, remove unused imports

## Internationalization (i18n)

**Mandatory**: All user-facing text must be internationalized using react-i18next.

### Rules

1. **Never hardcode user-facing strings** in JSX, component logic, or error messages
2. **Use translation keys** for all text visible to users:
   - UI labels, headings, descriptions
   - Button text and action labels
   - Form labels, placeholders, help text
   - Error messages and validation feedback
   - Toast notifications and alerts
   - Empty states and loading messages
   - Table headers, column names, filter labels

3. **Translation file structure:**
   - Location: `apps/web/src/locales/{en-US,zh-CN}/`
   - Namespaces: `common.json`, `navigation.json`, `changesets.json`, `repositories.json`, `organization.json`, `errors.json`, `validation.json`

4. **Translation key naming:**
   - Use descriptive, hierarchical keys: `"changesets.createDialog.title"`
   - Keep keys stable across refactors

5. **When adding or modifying UI text:**
   - Extract to appropriate namespace JSON file
   - Provide translations for **both** en-US and zh-CN
   - Use `useTranslation()` hook: `const { t } = useTranslation('namespace')`
   - Call `t('key')` or `t('key', { variable })` for interpolation

6. **Dynamic content:**
   - Use i18next interpolation: `t('key', { count: n })` for plurals
   - Use i18next context: `t('key', { context: 'variant' })` for variants

7. **Non-translatable:**
   - Technical identifiers (commit SHAs, IDs, URLs)
   - Code snippets, logs, API responses
   - Developer-facing console messages (can stay in English)

### Examples

```tsx
// ❌ Wrong: hardcoded string
<button>Create Changeset</button>

// ✅ Correct: translated
const { t } = useTranslation('changesets');
<button>{t('createButton')}</button>

// ❌ Wrong: hardcoded error message
throw new Error('Repository not found');

// ✅ Correct: translated error
const { t } = useTranslation('errors');
throw new Error(t('repositoryNotFound'));
```

When modifying an existing page not yet migrated to i18n, migrate **only the text you are adding or changing**. Do not perform full page migration unless requested.

## State and Persistence

### Local Storage (Prototype Only)

Current prototype uses browser local storage through a shared hook. Preserve that boundary rather than accessing localStorage throughout components.

- Namespace keys by product and feature: `agentforge:delivery:*`, `agentforge:resources:*`
- Handle unavailable, malformed, or quota-exceeded storage safely
- Treat as prototype persistence, not database or source of truth for multi-user system
- Do not store secrets, credentials, or sensitive tokens

### Server State Migration

When introducing backend persistence:
- Define repository/service interface
- Migrate feature consumers through that boundary
- Do not silently mix local mock state and remote state
- Do not add Redux, Zustand, or another state library without concrete cross-feature state requirement and design justification

## Domain and Workflow Invariants

The delivery workflow must preserve these rules:

1. Changeset keeps stable identity across revisions
2. Each Revision has distinct identity and belongs to exactly one Changeset
3. New Revision invalidates currentness of previous evaluation evidence and review decisions
4. Evidence is current only when its `revisionId` equals active Revision identity
5. Approval requires passing evidence for active Revision
6. Merge requires passing evidence and approved review decision for same active Revision
7. Failed, missing, or stale evaluation must block approval and merge
8. Review decision for older Revision must never authorize merging newer Revision
9. Revision has at most one active review (assigning new review supersedes pending one, refused after approval)

**Keep these rules in domain functions**, not only in disabled buttons or conditional UI. UI checks improve usability but are not authorization or integrity boundary.

## Mock Data and Integration Boundaries

This repository currently contains a frontend prototype with seeded data and browser-local persistence.

- Clearly label simulated actions and demo data as Mock, Demo, or local-only
- Do not claim local action created Git commit, ran remote CI, started Agent Runtime, sent review notification, or merged remote branch
- Keep fixtures and resource configuration separate from rendering logic
- Prefer deterministic mock services over embedding arbitrary business outcomes in click handlers
- Make mock behavior replaceable by real service adapters without rewriting UI
- Do not add fake API endpoints or pretend backend integrations exist
- If task adds real integration, document endpoint contract, error states, loading states, permissions, and configuration requirements

## Testing

Test behavior and invariants, not implementation details.

- Put pure domain tests next to domain module: `*.test.ts`
- Test stale evidence, stale review, approval gates, merge gates when delivery rules change
- For feature changes, cover affected user interaction and important empty, loading, error, disabled states
- Prefer deterministic fixtures, avoid time-dependent assertions
- Do not make tests depend on real GitHub, CI, network services, or developer credentials
- Add regression tests for fixed bugs
- Update tests when behavior intentionally changes (do not delete failing test to make CI green)

**Before finishing:**
```bash
npm test          # Run all tests
npm run build     # TypeScript check + production build
```

If either cannot be run, state explicitly and explain what remains unverified.

## UI and Design Consistency

- Reuse existing design tokens, spacing, typography, surfaces, interaction patterns in `styles/index.css`
- Prefer existing Lucide icons over emoji or hand-drawn substitutes
- Keep responsive behavior intentional across desktop and narrow viewports
- Keep tables, filters, inspectors, dialogs, empty states consistent across resource workspaces
- Avoid one-off inline styles when reusable class or design token is appropriate
- Do not add decorative UI that obscures primary task or makes page look more complete than underlying behavior

### GitHub-style list hover

Use `af-action-row` for compact sidebar and action-list entries. The neutral hover fill uses `--af-color-row-hover` so it works over the current surface in either theme. The row uses a 32 px minimum height, 8 px inline padding, and the medium radius token. Hover changes the fill without shifting layout or changing the label and icon colors.

- For a single action, apply the class to the ghost button. For separate primary and trailing actions, apply it to the list item and use sibling ghost buttons with accessible names. The fill covers both actions and each has its own keyboard focus ring.
- Enable the hover fill on hover-capable pointers. Disabled standalone rows skip it. Keep selection recognizable through the existing active label or indicator when hovered.
- Use this pattern for flat action rows.

## Change Workflow

For every task:

1. Inspect relevant feature, domain modules, tests, package scripts, CI workflow before editing
2. Identify owner layer and respect dependency direction
3. Confirm whether requested behavior is real integration or prototype-only
4. Make smallest coherent change (refactor adjacent code only when needed for clean boundary)
5. **If adding/modifying user-facing text**: Add translation keys to both en-US and zh-CN locale files, use `useTranslation()` and `t()`
6. Add or update tests for changed domain rules and user-visible behavior
7. Run tests and production build
8. Review diff for accidental behavior changes, dead code, duplicated state, incorrect domain terminology, **hardcoded user-facing strings**
9. Update README or relevant docs when architecture, commands, or contributor rules materially change
10. Use proper commit message format: `type(scope): description`

Do not perform unrelated cleanup, dependency upgrades, formatting churn, or architecture migrations as part of narrowly scoped feature request.

## Further Reading

- **[Backend Development Guide](backend.md)** — Go API standards
- **[AGENTS.md](../../AGENTS.md)** — Universal AI development standards
- **[CLAUDE.md](../../CLAUDE.md)** — Claude Code configuration
- **[Testing Guide](../testing/setup.md)** — Test environment setup
- **[Architecture Overview](../architecture/overview.md)** — System design
- **[Architecture Decisions](../architecture/decisions.md)** — ADRs including routing (ADR-008)
