import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    // The interface language follows the browser, so pin it: the assertions below read English
    // labels, and a machine whose browser reports another language would otherwise fail them.
    locale: "en-US",
    // Hermetic: every host except the local dev server fails to resolve at once, so no test waits on (or depends on)
    // the network, e.g. the Google Fonts @import in styles/index.css.
    launchOptions: { args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev --workspace @agentforge/web -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
