# Frontend browser tests

AgentForge uses Playwright and Chromium for component-level and application-level browser regression tests.

## Run locally

From the repository root:

```sh
npm ci
npm install --no-save --package-lock=false @playwright/test@1.56.1
npx playwright install chromium
npm run test:e2e
```

The runner starts the Vite development server. Application tests run against the real entry (`/`) and open pages through their URLs, for example `/projects` or `/orgs/demo/changesets`. The shared UI tests use the component-only harness at `apps/web/e2e-harness.html`, which mounts the command palette inside a `MemoryRouter` and shows the current location path in the `navigation-result` probe. Tests use deterministic API mocks and browser-local state; they do not require backend services, API keys, production accounts, or a deployed environment.

Always run the suite as `CI=1 npm run test:e2e`: without `CI`, Playwright silently reuses any server already listening on port 4173, which may serve another checkout.

## Coverage

### Shared UI

- Modal: initial focus, focus containment after focus escapes, Escape dismissal, backdrop dismissal, and focus restoration.
- Drawer: accessible heading, focus containment after focus escapes, Escape dismissal, and focus restoration.
- Popover: opening, Escape dismissal, and focus restoration.
- Tabs: ArrowRight navigation, selected state, and active value.
- CommandPalette: search filtering and navigation by URL, including the `current` organization alias used when no account is available.

### Application business flows

- Overview: changeset search, status filtering, row selection, and navigation to the full changeset workspace.
- Delivery: create a revision, run evaluation, approve the current revision, and complete the demo merge/Trail flow.
- Resources: search, status filtering, inspect a selected resource, and create a local project record.
- Changesets: load organization-scoped API records, search, and create a persisted changeset through the API boundary.
- Organization: update a member role and create/display an invitation through mocked API endpoints.
- Responsive shell: verify the Projects workspace remains usable at a 390px mobile viewport without document-level horizontal overflow.
- Routing: deep links, reload, and Back/Forward; every flat page opened directly; organization pages by slug, by id and through the `current` alias (replaced by the canonical URL without leaving a history entry); an unknown organization handle; the signed-out state; switching organization while keeping the sub-path; signing out; the not-found state inside the shell; and Ctrl+K navigation.

## API isolation

The application tests intercept `/api/v1/**` requests in Playwright (`apps/web/e2e/support/api-mocks.ts`). The mocks model the account context (organizations carry a `slug`; a second organization and a signed-out `401` are available per test), sign-out, organization members, invitations, audit history, and changeset list/create endpoints. No test sends a request to a real API. Browser local storage is cleared before each scenario so delivery workflow state is deterministic.

## CI

The existing frontend CI job installs the pinned Playwright test runner ephemerally after `npm ci`, installs Chromium, and runs `npm run test:e2e`. This keeps browser tooling out of the production dependency graph and leaves the application lockfile unchanged. The test suite is part of the existing web CI job and `ci-gate`; no separate deployment workflow is introduced.

Cloudflare production deployment validation is intentionally excluded.
