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

### Repository Issues

The repository and organization Issues pages use the same authenticated client. The legacy Issues tab links to the canonical repository page. The list shows loading and retry states. **New issue** checks the registered repository’s default branch at `/issues/new/choose`. Valid templates open `/issues/new?template=<filename>`. Repositories with no template configuration continue to `/issues/new`. Template reads reuse the authenticated Git tree and blob endpoints with a pinned commit after the initial tree request. Its Write and Preview tabs share the published issue's Markdown renderer. The composer preserves input on request failures and guards navigation away from unsaved edits. Attachments upload as drafts and are published with the issue. See the [Issues API contract](../../contracts/openapi/issues.yaml) for limits and response codes.

Viewers can read issues. Organization members can create issues. Owners and admins can set assignees, labels, milestone, and type at creation. Authors and organization admins or owners can edit, close, and reopen issues, subject to API authorization. The Project filter requires an Issue association in the data model and stays disabled.

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

Use the [pull request frontend standard](pull-requests.md) for repository change proposal and review screens.

- Reuse existing design tokens, spacing, typography, surfaces, interaction patterns in `styles/index.css`
- Prefer existing Lucide icons over emoji or hand-drawn substitutes
- Keep responsive behavior intentional across desktop and narrow viewports
- Keep tables, filters, inspectors, dialogs, empty states consistent across resource workspaces
- Avoid one-off inline styles when reusable class or design token is appropriate
- Do not add decorative UI that obscures primary task or makes page look more complete than underlying behavior

### Compact sidebar and action rows

Use the shared `af-action-row` pattern for flat sidebar navigation and action lists. [Shared component styles](../../apps/web/src/shared/ui/components/components.css)

| Property | Standard |
| --- | --- |
| Alignment | Start-align labels and vertically center icons and text. Keep the leading icon and label aligned across rows. |
| Size and spacing | Use a 32 px minimum height, 4 px block padding, and 8 px inline padding. Use a 16 px leading icon and an 8 px icon-to-label gap. Allow long labels to wrap and the row to grow. |
| Typography | Inherit the app's `system-ui, -apple-system, sans-serif` stack. Use 14 px labels at weight 400 with normal line height. Use weight 600 for the current navigation item where the navigation style supports it. |
| Shape and color | Use `--af-radius-md` (7 px), `--af-color-text` for resting labels, and `--af-color-row-hover` for the full-row hover fill in both themes. |

- Apply `af-action-row` to a single ghost button, or to the list item when the primary and trailing actions are separate. Use sibling ghost buttons with independent accessible names and visible keyboard focus. Align the trailing action to the end and reserve at least 32 px of width for it.
- Apply the hover fill only on hover-capable devices. Hover keeps row dimensions, text, and icon colors stable. Enabled actions use the hand cursor. Disabled standalone rows use the unavailable cursor and skip the hover fill. Keep the current item distinguishable during hover and keyboard focus.

#### Repository catalog reference

The repository catalog pairs a 248 px desktop sidebar (58 px when collapsed) with a flexible content column. The sidebar uses `--af-color-surface-raised`, 16 px padding, and a 0 px gap between navigation rows. The saved views group has a divider, with 8 px before it and 8 px after it. At 760 px and below, stack the sidebar above the content and let the navigation controls wrap with a 2 px gap. [Repository catalog styles](../../apps/web/src/pages/repositories/repositories.css)

| Text role | Repository catalog size |
| --- | --- |
| Page heading | `clamp(21px, 2.25vw, 27px)`, weight 650, line height 1.3 |
| Navigation and saved view labels | 14 px, weight 400. Current navigation label uses weight 600. |
| Group heading | 13 px, bold |
| Repository name | 16 px in detailed lists, 14 px in compact lists |
| Metadata and empty-state text | 13 px, `--af-color-text-secondary` |

Review changes in light and dark themes, on desktop and narrow screens, and with both hover and keyboard focus. Check that rows stay aligned and keep their size across interaction states. Browser coverage includes desktop row height and spacing, hover and cursor, and saved view interactions. [Repository browser tests](../../apps/web/e2e/repositories.pw.ts)

### Browser-based visual alignment

1. Open the reference page in a browser at a known viewport, zoom, and theme. Use DevTools or read-only DOM inspection to record font size, weight, line height, control bounds, gaps, and alignment. Record which page and state each measurement came from. If a surface requires sign-in, use the user-provided reference screenshots and identify those values as screenshot-based estimates.
2. Review the full component in its normal, selected, focus, disabled, and error states. Check overlay anchoring, keyboard navigation, focus restoration, and how the layout wraps on a narrow screen.
3. Apply the reference's layout and interaction patterns with AgentForge's components, theme, copy, and domain rules. Keep page-specific adjustments scoped to their page. Reuse measurements as shared tokens only when they apply across surfaces.
4. Capture local desktop and narrow-screen screenshots for review. Add targeted Playwright checks for the key geometry and interactions with local fixtures or the local API. Keep GitHub out of the test runtime.

For the new-repository form, check that steps 1 and 2 share the rail's centerline and align vertically with their section headings. Use 20 px for the page title, 16 px for section headings, 14 px for labels and control text, and 12 px for helper text. The Owner picker and repository-name field are both 32 px high. Verify that the form and its menus fit at 320 px.

### Organization settings

Use GitHub Primer as a reference for buttons, labels, and anchored action menus. Keep the AgentForge organization header, typography, and theme tokens. Reuse the shared `Button`, `Tabs`, `Select`, `Popover`, and `ConfirmDialog` components, with overrides scoped to organization settings. [Page styles](../../apps/web/src/pages/organization/organization-settings.css)

| Control | Standard |
| --- | --- |
| Buttons | Use the green primary button for Invite member and Create invitation in their respective panels. Use neutral controls for refresh and copy, and give icon-only actions a descriptive accessible name. Use 32 px height, 14 px text, and 6 px corners for standard controls. |
| Tabs | Mark the active tab with an underline, stronger text, and `aria-selected`. Show neutral count pills for Members and Invitations after data loads. Let tabs wrap on narrow screens to keep every label fully visible. Move focus to the email field when Invite member opens the Invitations tab. |
| Status labels | Use a compact outline pill with localized text. Use success for Active and Accepted, warning for Invited and Pending, danger for Suspended, Removed, and Revoked, and neutral for Expired and other statuses. Keep read-only roles visibly distinct from editable role controls. |
| Role picker | Use an anchored single-select with a chevron and a checkmark beside the current role. Offer only roles the actor can assign. Support arrow keys and Enter, and close on Escape with focus returned to the trigger. |
| Row actions | Group suspend or reactivate and remove in a trailing ellipsis popover. Give the trigger a name that identifies the member. Focus the first action on open and return focus to the trigger on Escape. Style Remove member as a danger action and require explicit confirmation. |

Use semantic theme tokens for surfaces, borders, hover, and status colors. Check visible focus and text contrast in both themes, and localize labels and feedback in `en-US` and `zh-CN`. At 320 px, keep the role picker and row actions reachable without horizontal page scrolling. Move status and date into the identity cell and stack the invitation form. Review loading, empty, error, and restricted states alongside the populated layout. [Organization settings browser tests](../../apps/web/e2e/organization-settings.pw.ts)

### Repository header

Show the repository owner and name once in the Topbar. Place the repository navigation on the same surface directly below it, with a divider under the navigation. Keep page titles and page-specific actions in the page body. Use route links with `aria-current="page"` and a visible underline for the active section, including on nested issue and pull request URLs. Keep the row horizontally scrollable on narrow screens and every link reachable by keyboard.

### Topbar search

Use the shared topbar search dialog for workspace and repository routes. Center it at the top of the viewport and keep results scrollable within the panel. Use a single-line input with a leading search icon, a visible primary-color focus outline, and a trailing clear button when the input has text. Highlight the value of `repo:` with `--af-color-primary-subtle` inside the editable input. Show scope suggestions as compact rows below the input with action hints aligned to the end. Keep the input and clear button usable on narrow screens.

| State | Behavior |
| --- | --- |
| Open and empty | Focus the input on open. Prefill `repo:owner/name ` on a repository route. An empty query can show recent searches, repositories, and pages. |
| Partial `repo:` | Suggest matching repositories from the current workspace. Selecting a suggestion completes the qualifier and keeps focus in the input. |
| Valid `repo:` | With no keywords, offer the repository's Issues list. With keywords, show matching issue previews and scoped actions for Issues and Changesets. Choosing the workspace search action removes the qualifier and keeps the keywords. |
| Unavailable or invalid scope | Show guidance when the qualifier has no accessible match or the query contains multiple `repo:` qualifiers. Keep scoped requests blocked until the scope is valid. |
| Loading, empty results, or failure | Show status feedback while loading and when there are no matches. Offer retry when the repository list or issue previews fail to load. |

Resolve repository scopes against the server-provided catalog for the active workspace. Search stays within that workspace and the organization switch lives in workspace navigation. Keep recent searches separate by account and workspace.

Support `Ctrl+K` or `Cmd+K` to open, with `/` as a shortcut outside editable controls. Use arrow keys to select results, Enter to activate, and Escape to close and restore focus. Let IME composition finish before running a query. When no result is selected, Enter uses the first applicable result once loading completes. Broader workspace search requires explicit selection. [Topbar search browser tests](../../apps/web/e2e/topbar-search.pw.ts)

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
