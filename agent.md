# Mandatory AI entry rule

**Every AI agent, coding assistant, or automated contributor MUST read this entire `agent.md` before inspecting, planning, editing, testing, or otherwise acting on this repository.** This is the first repository-specific step for every task, including delegated sub-agents and resumed sessions. Do not begin work until the guide has been read and its constraints are understood. If an instruction conflicts with a user request, stop and clarify rather than silently violating the repository constraints. Re-read this guide when a task starts in a new session or when the guide changes.

This document defines the working rules for AI agents and contributors modifying this repository. Follow it before making code changes.

## 1. Product context

The product identity, domain terminology, and prototype boundaries below are binding constraints for all implementation work.

AgentForge is an **Agent-native Source Control & Verified Change Platform**. It is not an Agent Runtime and should not be reduced to an AI-themed GitHub clone.

The frontend is currently a React + TypeScript prototype. Treat the existing product flows and domain distinctions as intentional unless a task explicitly changes them.

### Non-negotiable domain distinctions

- **Git Commit**: an immutable Git object identified by its full commit SHA.
- **Changeset**: a stable product-level unit of proposed change, with its own stable ID.
- **Revision**: an iteration of a Changeset. A new Revision does not create a new Changeset identity.
- **Evidence**: evaluation output bound to the exact Revision it evaluated.
- **Review decision**: approval or requested changes bound to the exact Revision reviewed.
- **Trail**: the traceable sequence of work and evidence associated with delivery.

Never use a Changeset ID as a Git commit SHA or Revision ID. Never treat evidence or approval for an older Revision as valid for the current Revision.

## 2. Technology and commands

Use the existing stack unless a task explicitly approves a migration:

- React 19 and React DOM
- TypeScript 5 with strict mode
- Vite 6
- Vitest 3
- React Router (`react-router-dom`, data router) owns navigation state; it lives in the URL, not in `useState`. Routing rules (decided in ADR-008):
  - `app/routes.tsx` is the single route table and the only place that declares routes (`main.tsx` mounts it with `createBrowserRouter`). Changing a URL or adding a page means updating `app/routes.tsx`, `app/navigation.ts`, the route tests and ADR-008 together.
  - Pages backed by the real API are organization-scoped: `/orgs/:org/changesets`, `/orgs/:org/repositories`, `/orgs/:org/trails`, `/orgs/:org/review`, `/orgs/:org/eval` and `/orgs/:org/settings` (Organization). `:org` is an organization handle: its `slug`, or its `id` (an exact `id` match wins; slugs match case-insensitively). The literal handle `current` is a client-side alias for the selected organization; once the account is known it is replaced (history `replace`) by that organization's own handle, keeping query and hash.
  - Mock and fixture pages stay flat so they remain browsable without a session: `/` (Overview), `/projects`, `/workspaces`, `/stacks`, `/self-healing`, `/memory`, `/pipelines`, `/security`, `/governance`, `/usage`, `/settings` and `/dev/ui`. Move a page under `/orgs/:org` only when a real backend capability replaces its mock data. Any other path renders the not-found state inside the shell.
  - `/api/*` and `/auth/*` are backend paths on the same origin and are never client routes. The SSO entry stays a plain `<a href="/auth/oidc/login">` (full-page navigation).
  - Pages must not import `app`: they build links only through `shared/routing` (`orgPath`, `flatPaths`, `CURRENT_ORGANIZATION_HANDLE`) instead of hard-coding path strings. The sidebar and command palette are built from `app/navigation.ts`. The page title, eyebrow and breadcrumb come from the matched route's `handle.label` in `app/routes.tsx` (read with `useMatches()`); only the page description comes from `navigation.ts`. `app/routes.test.ts` enforces that every navigation item has its own route whose `handle.label` equals the item's label.
  - Sidebar items are `NavLink`s with `end`, so an unknown path below a page (`/projects/extra`) highlights nothing; drop `end` for an item only when its section gets nested routes. The router serves `/projects/` like `/projects` and matches static segments case-insensitively, so the app removes a trailing slash and writes `/orgs/` in lowercase when it rewrites a handle.
  - Pages sit under the layout route that carries the `errorElement` (the root route has its own fallback), so a page that throws replaces only the page area and the shell stays. Error messages and stacks are logged to the console and never rendered to users; `app/routes.test.ts` checks that every navigation page and the not-found route are under such a boundary.
- Lucide React for icons
- Recharts for charts where appropriate
- **react-i18next** for internationalization (i18n)
  - All user-facing text must be externalized to translation files under `apps/web/src/locales/`
  - Use the `useTranslation()` hook and `t()` function for runtime translation
  - Organize translations by namespace: `common`, `navigation`, `changesets`, `repositories`, `organization`, `errors`, `validation`
  - Support both English (en-US) and Chinese (zh-CN)
  - Never hardcode user-facing strings directly in JSX or component logic

Node.js 22 is used by GitHub Actions.

Common commands:

- Install dependencies: npm install
- Start development server: npm run dev
- Run tests: npm test
- Run TypeScript check and production build: npm run build
- Validate Cloudflare Worker packaging without deploying: npm run deploy:dry-run
- Preview production build: npm run preview

The CI workflow runs dependency installation, tests, and production build. Run tests and build before considering a change complete. Do not claim a check passed unless its result was observed.

## 3. Frontend architecture

### Target module organization

Migrate incrementally toward a simplified Feature-Sliced structure only when code is being changed; do not perform a wholesale directory migration or create empty layers.

- `app/`: application bootstrap, providers, routing, layouts, global shell and composition.
- `pages/`: route-level page composition and page-specific view state. A page should compose sections rather than implement every section inline.
- `features/`: user actions and workflows with a clear user intent, such as create changeset, run evaluation, request review, approve review and merge changeset. Do not use this layer as a generic bucket for every screen.
- `entities/`: reusable business-entity model, API contracts and entity-owned UI where multiple pages/features need them. Introduce only when a real shared entity boundary exists.
- `shared/`: business-agnostic UI primitives, hooks, utilities, configuration and infrastructure.
- `domain/`: retain framework-independent business invariants and pure rules; do not move domain logic into React components.

The Overview page lives in `pages/overview`, and navigation-level resource workspaces live in `pages/resources`. The delivery workflow remains in `features/delivery` until its boundary can be migrated safely. This is an incremental target, not a claim that all layers already exist.

### Componentization rules

- Componentization and module organization are separate concerns: use modules to define ownership/dependency boundaries and React components to define cohesive UI responsibilities.
- Split a large page into named components when sections have independent presentation, interaction, state, or a clear semantic role. Keep the page as a composition root.
- Prefer colocating components with the page or feature that owns them. Promote a component to `shared/ui` only when it is genuinely business-agnostic and reused across independent modules.
- Keep component props explicit and narrow. Lift state only to the nearest common owner that needs to coordinate consumers.
- Extract repeated data/configuration from JSX into typed module-owned data files.
- Avoid both extremes: monolithic page components and trivial one-line components created solely to reduce line count.
- Do not create global `components/`, `utils/`, `helpers/` or `common/` dumping grounds.
- Use PascalCase for React component files and exports; kebab-case for ordinary TypeScript modules and directories; use `useXxx.ts` for hooks; use `*.test.ts(x)` for tests.
- Internal module files should be imported through their owning module's public entry point when crossing module boundaries. Same-module relative imports are acceptable.
- Enforce dependency direction: `app -> pages/features/entities/shared`, `pages -> features/entities/shared/domain`, `features -> entities/shared/domain`, and `domain -> entities` (type-level domain vocabulary only). Entity models are foundational and must not depend on feature, page, app or React code. Avoid feature-to-feature imports and circular dependencies.



Organize code by **feature ownership and dependency direction**, not by creating large global folders that mix unrelated business concerns.

Current implemented structure:

    src/
      app/                         Application shell, navigation and composition
        components/                Shell-owned UI components
        routes.tsx                 The route table: the only place that declares routes
      pages/
        overview/                  Overview page, page sections, view model and fixtures
        resources/                 Resource workspace page composition, page config and sections
          data/                    Resource fixtures and page configuration
          ui/                      Resource list and inspector sections
      features/
        delivery/                  Changeset delivery workflow
          hooks/                   React state and persistence adapter
          ui/                      Delivery workflow presentation components
          use-cases/                Create revision, run evaluation, decide review and merge
          workflow.ts              Compatibility re-export for delivery use cases
      entities/
        changeset/                 Changeset identity and core type
        revision/                  Revision identity and core type
        evidence/                  Revision-scoped evaluation evidence
        review/                    Revision-scoped review decision
        resource-records/          Typed records for project, repository, workspace and resource workspaces
      domain/
        delivery/                  Framework-independent delivery invariants and tests
      shared/
        hooks/                     Reusable React hooks and persistence
        routing/                   Pure URL path builders and organization-handle resolution
      styles/                      Global tokens, resets and application styling
      main.tsx                     React bootstrap

This is an intentionally incremental structure. Do not move every existing feature in one pass. For a new or substantially changed screen, decide whether its code belongs to a route-level `pages` module or a user-intent `features` module. A page may compose feature workflows and entity views; it should not become a generic feature bucket.
A module may contain only the subfolders it actually needs. Common optional responsibilities include `ui/`, `model/`, `api/`, `data/` and a public `index.ts`. Do not create empty folders pre-emptively. Add a subfolder when it provides a real ownership boundary.

### Layer responsibilities

**app**
- Owns application composition, top-level navigation, global providers and shell-level concerns.
- Connects page and feature entry points.
- Must not become the home for feature business logic or large page implementations.
- Keep App.tsx focused. Extract the shell, overview page, command palette, dialogs and other substantial UI into appropriately owned components as they evolve.

**pages**
- Owns navigation-level screen composition and page-specific view state.
- Composes feature workflows and entity views; keep route-specific configuration alongside the owning page.
- Extract reusable user actions into `features` only when they have a clear workflow boundary.

**features**
- Owns user-facing workflows, feature components, feature-specific hooks and orchestration.
- May call domain functions and shared utilities.
- Should expose a small public entry point to pages or app.

**domain**
- Owns framework-independent business types, identity rules, invariants and pure business logic.
- Must not import React, browser APIs, feature UI or app modules.
- Prefer deterministic pure functions that can be tested without rendering components.
- Keep domain concepts explicit; avoid generic types that blur Changeset, Revision, Commit and Evidence.

**shared**
- Contains genuinely reusable UI-independent hooks and infrastructure.
- Do not move feature-specific behavior here just because it is used by two components in one feature.
- Avoid turning shared into a miscellaneous dumping ground.

**styles**
- Owns global tokens, resets, typography and cross-application layout primitives.
- Feature-specific styling should remain clearly scoped and named.
- Avoid broad selectors that unintentionally affect unrelated pages.

### Dependency direction

Allowed direction:

    app -> pages/features/entities/shared
    pages -> features/entities/shared/domain
    features -> entities/shared/domain
    domain -> entities (type-level domain vocabulary only)

Entity models are foundational and must not depend on feature, page, app or React code. Domain rules may consume entity types but remain framework-independent.

Disallowed:
- domain importing app, pages, features, React or browser-specific modules
- entities importing app, pages, features or React
- shared importing business modules
- domain importing shared UI or React hooks
- circular dependencies between features
- feature modules reaching into another feature's private implementation

When two features need the same capability, first decide whether it is a domain concept, a shared utility, or an explicit feature-level contract. Do not solve coupling with arbitrary cross-feature imports.

## 4. React component practices

- Use function components and hooks.
- Keep components focused on one cohesive responsibility.
- Extract a component when it has a distinct purpose, meaningful internal state, reusable presentation, or makes its parent substantially easier to understand.
- Keep page components as composition layers; move complex sections into named components.
- Keep render logic declarative. Avoid deeply nested conditional JSX and large inline callbacks.
- Use stable, meaningful keys for mapped elements. Never use array indexes as keys when items can be inserted, removed or reordered.
- Do not mutate props, state, arrays or objects. Use immutable updates.
- Do not mirror derived values in state. Derive them during render or with useMemo only when calculation cost or referential stability justifies it.
- Do not use useMemo or useCallback mechanically. Add them for measured expensive calculations, stable dependency contracts, or memoized child boundaries.
- Keep effects for synchronizing with external systems. Do not use effects to calculate values that can be derived during render.
- Every effect must have correct dependencies and cleanup where needed.
- Avoid defining stateful component types inside another component; doing so can cause remounts and lost state.
- Use controlled inputs when the UI must reflect application state. Validate user input at the boundary.
- Use semantic HTML, accessible labels, keyboard operation, visible focus states and appropriate dialog behavior.
- Avoid unnecessary prop drilling. Prefer composition and feature-level hooks before introducing global state.

## 5. State and persistence

Choose state ownership deliberately:

1. Component state for short-lived, local interaction state.
2. Feature hooks/state for workflows shared by components within one feature.
3. URL state for navigable, shareable filters or selections when routing is implemented for that flow.
4. Server state for data owned by a backend once API integration exists.
5. Shared application state only for genuinely cross-feature client state.

The current prototype uses browser local storage through a shared hook for demo persistence. Preserve that boundary rather than accessing localStorage throughout components. Resource workspace records are discriminated entity types owned by `entities/resource-records`; `pages/resources/data/resourceRecords.ts` is only a page adapter for legacy migration and table projection. Keep page-specific records distinct instead of reintroducing a generic `Item` model.

- Namespace storage keys by product and feature, for example agentforge:delivery:* and agentforge:resources:*.
- Handle unavailable, malformed or quota-exceeded storage safely.
- Treat local storage as prototype persistence, not as a database or source of truth for a multi-user system.
- Do not store secrets, credentials or sensitive tokens in local storage.
- When introducing backend persistence, define a repository/service interface and migrate feature consumers through that boundary. Do not silently mix local mock state and remote state.
- Do not add Redux, Zustand or another state library without a concrete cross-feature state requirement and a short design justification.

## 6. Domain and workflow invariants

The delivery workflow must preserve these rules:

- A Changeset keeps its stable identity across revisions.
- Each Revision has a distinct identity and belongs to exactly one Changeset.
- A new Revision invalidates the currentness of previous evaluation evidence and review decisions.
- Evidence is current only when its revisionId equals the active Revision identity.
- Approval requires passing evidence for the active Revision.
- Merge requires passing evidence and an approved review decision for the same active Revision.
- A failed, missing or stale evaluation must block approval and merge.
- A review decision for an older Revision must never authorize merging a newer Revision.
- A Revision has at most one active review: assigning a new review supersedes a pending one and is refused after an approval.

Keep these rules in domain functions, not only in disabled buttons or conditional UI. UI checks improve usability but are not an authorization or integrity boundary.

Keep Git object identity explicit. When Git integration is introduced, store full commit SHAs separately from Changeset and Revision identifiers.

## 7. Mock data and integration boundaries

This repository currently contains a frontend prototype with seeded data and browser-local persistence.

- Clearly label simulated actions and demo data as Mock, Demo or local-only where users could otherwise mistake them for real operations.
- Do not claim that a local action created a Git commit, ran remote CI, started an Agent Runtime, sent a review notification, or merged a remote branch.
- Keep fixtures and resource configuration separate from rendering logic.
- Prefer deterministic mock services for workflows over embedding arbitrary business outcomes in click handlers.
- Make mock behavior replaceable by real service adapters without rewriting the UI.
- Do not add fake API endpoints or pretend backend integrations exist.
- If a task adds a real integration, document the endpoint contract, error states, loading states, permissions and configuration requirements.

## 8. TypeScript and code quality

- Keep strict TypeScript enabled.
- Avoid any. Use explicit domain types, discriminated unions and unknown with narrowing where appropriate.
- Use type-only imports for types when applicable.
- Give exported functions and non-obvious domain structures clear types.
- Prefer small functions with one reason to change.
- Use names that describe the domain intent; avoid vague names such as data, item, handler or manager when a more precise name is available.
- Avoid premature abstractions and speculative frameworks.
- Do not add dependencies for functionality that can be implemented cleanly with the existing stack.
- Keep imports at the top of the module and remove unused imports.
- Preserve existing user-visible behavior unless the task explicitly changes it.

## 9. Testing

Test behavior and invariants, not implementation details.

- Put pure domain tests next to the domain module using the *.test.ts naming convention.
- Test stale evidence, stale review, approval gates and merge gates whenever delivery rules change.
- For feature changes, cover the affected user interaction and important empty, loading, error and disabled states as applicable.
- Prefer deterministic fixtures and avoid time-dependent assertions.
- Do not make tests depend on real GitHub, CI, network services or developer credentials.
- Add regression tests for fixed bugs.
- Update tests when behavior intentionally changes; do not delete a failing test merely to make CI green.

Before finishing, run:

1. npm test
2. npm run build

If either command cannot be run, state that explicitly and explain what remains unverified.

## 10. UI and design consistency

- Reuse existing design tokens, spacing, typography, surfaces and interaction patterns in styles/index.css.
- Prefer existing Lucide icons over emoji or hand-drawn substitutes for product UI icons.
- Keep responsive behavior intentional across desktop and narrow viewports.
- Keep tables, filters, inspectors, dialogs and empty states consistent across resource workspaces.
- Avoid one-off inline styles when a reusable class or design token is appropriate.
- Do not add decorative UI that obscures the primary task or makes a page look more complete than its underlying behavior.

## 11. Internationalization (i18n)

The application supports multiple languages using react-i18next. All user-facing text must be internationalized.

**Mandatory i18n rules:**

1. **Never hardcode user-facing strings** in JSX, component logic, or error messages
2. **Use translation keys** for all text visible to users:
   - UI labels, headings, and descriptions
   - Button text and action labels
   - Form labels, placeholders, and help text
   - Error messages and validation feedback
   - Toast notifications and alert messages
   - Empty states and loading messages
   - Table headers, column names, and filter labels
3. **Translation file structure:**
   - Location: `apps/web/src/locales/{en-US,zh-CN}/`
   - Namespaces: `common.json`, `navigation.json`, `changesets.json`, `repositories.json`, `organization.json`, `errors.json`, `validation.json`
   - Use the appropriate namespace for the feature being modified
4. **Translation key naming:**
   - Use descriptive, hierarchical keys: `"changesets.createDialog.title"` not `"title1"`
   - Keep keys stable across refactors; rename with care as they affect all languages
5. **When adding or modifying UI text:**
   - Extract the text to the appropriate namespace JSON file
   - Provide translations for **both** en-US and zh-CN
   - Use `useTranslation()` hook: `const { t } = useTranslation('namespace')`
   - Call `t('key')` or `t('key', { variable })` for interpolation
6. **Dynamic content and pluralization:**
   - Use i18next interpolation: `t('key', { count: n })` for plurals
   - Use i18next context for gender/variant: `t('key', { context: 'variant' })`
7. **Non-translatable content:**
   - Technical identifiers (commit SHAs, IDs, URLs) remain untranslated
   - Code snippets, logs, and API responses remain as-is
   - Developer-facing error messages in console.log/console.error can stay in English

**Examples:**

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

When modifying an existing page that has not yet been migrated to i18n, you must migrate only the text you are adding or changing. Do not perform a full page migration unless explicitly requested.

## 12. Change workflow

For every task:

1. Inspect the relevant feature, domain modules, tests, package scripts and CI workflow before editing.
2. Identify the owner layer for the change and respect the dependency direction.
3. Confirm whether the requested behavior is real integration or prototype-only behavior.
4. Make the smallest coherent change. Refactor adjacent code only when needed to preserve a clean boundary.
5. **If adding or modifying user-facing text:** Add translation keys to both `en-US` and `zh-CN` locale files in the appropriate namespace. Use `useTranslation()` and `t()` instead of hardcoded strings.
6. Add or update tests for changed domain rules and user-visible behavior.
7. Run tests and production build.
8. Review the diff for accidental behavior changes, dead code, duplicated state, incorrect domain terminology, and **hardcoded user-facing strings**.
9. Update README or this guide when architecture, commands or contributor rules materially change.
10. Use a concise commit message describing the change. Never claim a commit or CI result that has not been verified.

Do not perform unrelated cleanup, dependency upgrades, formatting churn or architecture migrations as part of a narrowly scoped feature request.

## 12. Documentation and communication

- Keep documentation aligned with the code that actually exists.
- Distinguish current implementation, planned architecture and future backend integration.
- Do not document mock behavior as production capability.
- Record architectural decisions when they materially affect future work.
- In completion summaries, report changed areas, tests/build results, commit reference and remaining limitations.
