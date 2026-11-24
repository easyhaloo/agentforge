import { expect, test } from "@playwright/test";
import { demoOrganization, installApiMocks, labsOrganization } from "./support/api-mocks";
import { navigation, navigationToggle, openNavigation } from "./support/navigation";
import { selectOption } from "./support/select-option";

test("workbench uses the selected organization and keeps navigation usable on mobile", async ({ page }, testInfo) => {
  await installApiMocks(page, { organizations: [{ ...demoOrganization, personal: true }, labsOrganization] });
  await page.route("**/api/v1/organizations/org-demo/pipelines", route => route.fulfill({ json: { items: [
    { id: "build", name: "Main branch build", status: "published", revision: 3, version: 1 },
    { id: "deploy", name: "Staging deploy", status: "draft", revision: 1, version: 0 },
  ] } }));
  await page.route("**/api/v1/organizations/org-labs/**", route => route.fulfill({ json: { items: [], total: 0 } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText(demoOrganization.name, { exact: true })).toHaveCount(0);
  await expect(page.getByText("@demo", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("combobox")).toHaveCount(0);
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

  const mobileNavigation = await openNavigation(page);
  await expect(mobileNavigation.getByRole("combobox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^User menu,/ }).click();
  await page.getByRole("dialog", { name: "User menu" }).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL("/settings/profile");
  const current = page.getByRole("combobox", { name: "Current organization" });
  await expect(current).toContainText("Taylor Owner · Personal workspace");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await selectOption(page, current, "AgentForge Labs");
  await expect(current).toContainText("AgentForge Labs");
  await expect(page.getByRole("link", { name: "Organization settings" })).toHaveAttribute("href", "/orgs/labs/settings");
  await page.reload();
  await expect(current).toContainText("AgentForge Labs");
  await page.getByRole("link", { name: "agentforge", exact: true }).click();
  await expect(page.getByText("No changesets are waiting for your review.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Main branch build/ })).toHaveCount(0);
  await expect(repositories.getByRole("link", { name: "easyhaloo/agentforge" })).toHaveCount(0);
  await page.getByRole("button", { name: /^User menu,/ }).click();
  const userMenu = page.getByRole("dialog", { name: "User menu" });
  await expect(userMenu.getByRole("link", { name: "Organization settings" })).toHaveAttribute("href", "/orgs/labs/settings");
});

test("global navigation uses compact rows and returns focus through each dismissal path", async ({ page }, testInfo) => {
  await installApiMocks(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/orgs/demo/changesets");
  const toggle = navigationToggle(page);
  const drawer = page.getByRole("dialog", { name: "Global navigation" });
  const nav = await openNavigation(page);
  const close = drawer.getByRole("button", { name: "Close drawer" });
  const current = nav.getByRole("link", { name: "Changesets" });
  const lastLink = nav.getByRole("link", { name: "Cost & Usage", exact: true });

  await expect(drawer).toHaveCSS("width", "320px");
  await expect(drawer).toHaveCSS("transition-duration", "0.3s");
  await expect(drawer.getByText("Global navigation", { exact: true })).toHaveCount(0);
  await expect(nav.locator('a[href$="/settings"]')).toHaveCount(0);
  await expect(current).toHaveCSS("font-size", "14px");
  await expect(current).toHaveCSS("height", "32px");
  await expect(current.locator("svg")).toHaveCSS("width", "16px");
  await expect(current).toHaveAttribute("aria-current", "page");
  await expect(nav.locator("section").nth(1)).toHaveCSS("border-top-width", "1px");
  await expect(page.locator("body")).toHaveCSS("overflow-y", "hidden");
  await expect(close).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("drawer-light-desktop.png") });
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("link", { name: "Overview", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastLink).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await close.click();
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
  await openNavigation(page);
  await page.mouse.click(500, 200);
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 640 });
  await openNavigation(page);
  await expect(drawer).toHaveCSS("width", "288px");
  await expect(drawer).toHaveCSS("transition-duration", "0s");
  await expect(close).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("drawer-dark-mobile.png") });
  await lastLink.scrollIntoViewIfNeeded();
  await expect(lastLink).toBeInViewport();
  await expect(close).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow-y", "hidden");
});
