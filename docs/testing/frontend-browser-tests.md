# Frontend browser tests

AgentForge runs browser-level regression tests for shared UI components with Playwright and Chromium.

## Run locally

From the repository root:

```sh
npm ci
npm install --no-save --package-lock=false @playwright/test@1.56.1
npx playwright install chromium
npm run test:e2e
```

The test runner starts the Vite development server and serves `apps/web/e2e-harness.html`. The harness imports the actual shared UI components and CommandPalette; it does not require backend services, API keys, or production accounts.

## Current coverage

- Modal: initial focus, focus containment after focus escapes, Escape dismissal, backdrop dismissal, and focus restoration.
- Drawer: accessible heading, focus containment after focus escapes, Escape dismissal, and focus restoration.
- Popover: opening, Escape dismissal, and focus restoration.
- Tabs: ArrowRight navigation, selected state, and active value.
- CommandPalette: search filtering and navigation selection.

## CI

The existing frontend CI job installs the pinned Playwright test runner ephemerally after `npm ci`, installs Chromium, and runs `npm run test:e2e`. This keeps browser tooling out of the production dependency graph and leaves the application lockfile unchanged.

The suite is a component-level browser regression baseline. It does not yet replace end-to-end business-flow coverage for Overview, Delivery, Resources, Changesets, or Organization. Cloudflare production deployment validation is intentionally excluded.
