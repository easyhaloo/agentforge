import { expect, test } from "@playwright/test";
import { demoOrganization, installApiMocks } from "./support/api-mocks";

const api = `**/api/v1/organizations/${demoOrganization.id}`;

/**
 * Owner suspends the organization -> the warning banner appears, write
 * actions become inactive -> the owner resumes. (SPEC section 5)
 */
test("owner suspends the organization, sees the banner, and resumes", async ({ page }) => {
  await installApiMocks(page);
  let status = "active";
  await page.route(`${api}/identity-health`, (route) => route.fulfill({ json: { ready: true, summary: "ready" } }));
  await page.route(`${api}/members?*`, (route) => route.fulfill({ json: { items: [], limit: 100, offset: 0 } }));
  await page.route(`${api}/membership-audit?*`, (route) => route.fulfill({ json: { items: [], limit: 100, offset: 0 } }));
  await page.route(`${api}/audit?*`, (route) => route.fulfill({ json: { items: [], total: 0, limit: 100, offset: 0 } }));
  await page.route(`${api}/suspend`, (route) => {
    expect(route.request().method()).toBe("POST");
    status = "suspended";
    return route.fulfill({ json: { ...demoOrganization, status, suspended_at: "2026-11-26T10:00:00Z", suspended_reason: "demo" } });
  });
  await page.route(`${api}/resume`, (route) => {
    expect(route.request().method()).toBe("POST");
    status = "active";
    return route.fulfill({ json: { ...demoOrganization, status } });
  });

  await page.goto("/orgs/demo/settings/general");
  await expect(page.getByRole("heading", { level: 2, name: "Danger zone" })).toBeVisible();

  // Suspend with the typed confirmation.
  await page.getByRole("button", { name: "Suspend organization" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Type .* to confirm/).fill(demoOrganization.slug);
  await dialog.getByRole("button", { name: "Suspend organization" }).click();

  // The warning banner replaces the dialog; writes are inactive.
  await expect(page.locator(".af-alert--warning")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update profile" })).toHaveAttribute("aria-disabled", "true");

  // Resume restores normal state.
  await page.getByRole("button", { name: "Resume organization" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".af-alert--warning")).toHaveCount(0);
});
