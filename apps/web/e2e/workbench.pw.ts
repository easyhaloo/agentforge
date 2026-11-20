import { expect, test } from "@playwright/test";
import { demoOrganization, installApiMocks, labsOrganization } from "./support/api-mocks";
import { navigation, navigationToggle, openNavigation } from "./support/navigation";
import { selectOption } from "./support/select-option";

test("workbench uses the selected organization and keeps navigation usable on mobile", async ({ page }, testInfo) => {
  await installApiMocks(page, { organizations: [demoOrganization, labsOrganization] });
  await page.route("**/api/v1/organizations/org-demo/pipelines", route => route.fulfill({ json: { items: [
    { id: "build", name: "Main branch build", status: "published", revision: 3, version: 1 },
    { id: "deploy", name: "Staging deploy", status: "draft", revision: 1, version: 0 },
  ] } }));
  await page.route("**/api/v1/organizations/org-labs/**", route => route.fulfill({ json: { items: [], total: 0 } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const repositories = page.getByRole("region", { name: "Repositories", exact: true });
  await expect(repositories.getByRole("link", { name: "easyhaloo/agentforge" })).toHaveAttribute("href", "/orgs/demo/repositories?repository=easyhaloo%2Fagentforge");
  await expect(page.getByRole("region", { name: "Your work" }).getByText("Browser test baseline")).toBeVisible();
  await expect(page.getByRole("link", { name: /Main branch build/ })).toHaveAttribute("href", "/orgs/demo/pipelines/build/edit");
  await page.screenshot({ path: testInfo.outputPath("desktop.png"), animations: "disabled" });

  await openNavigation(page);
  await expect(navigation(page).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: testInfo.outputPath("navigation.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(navigation(page)).toBeHidden();
  await expect(navigationToggle(page)).toBeFocused();

  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath("mobile.png"), animations: "disabled", fullPage: true });

  await selectOption(page, page.getByRole("combobox", { name: "Select organization" }), "AgentForge Labs");
  await expect(page.getByText("No changesets are waiting for your review.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Main branch build/ })).toHaveCount(0);
  await expect(repositories.getByRole("link", { name: "easyhaloo/agentforge" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Organization settings" })).toHaveAttribute("href", "/orgs/labs/settings");
});
