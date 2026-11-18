import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e-harness.html");
});

test("modal traps focus, closes with Escape, and restores the opener", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open modal" });
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "Browser test modal" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeFocused();

  await page.getByTestId("outside-focus-target").evaluate((element: HTMLElement) => element.focus());
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close dialog" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("modal closes on backdrop click", async ({ page }) => {
  await page.getByRole("button", { name: "Open modal" }).click();
  await expect(page.getByRole("dialog", { name: "Browser test modal" })).toBeVisible();
  await page.locator(".af-modal-backdrop").click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("dialog", { name: "Browser test modal" })).toBeHidden();
});

test("drawer traps focus and closes with Escape", async ({ page }) => {
  const opener = page.getByRole("button", { name: "Open drawer" });
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "Browser test drawer" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Browser test drawer" })).toBeVisible();

  await page.getByTestId("outside-focus-target").evaluate((element: HTMLElement) => element.focus());
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Drawer action" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
});

test("popover closes with Escape and restores trigger focus", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Open popover" });
  await trigger.click();
  const popover = page.getByRole("dialog", { name: "Browser test popover" });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole("button", { name: "Popover action" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("tabs support arrow-key navigation and update the selected tab", async ({ page }) => {
  const overview = page.getByRole("tab", { name: "Overview" });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Activity" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("active-tab")).toHaveText("Active tab: activity");
});

test("command palette filters destinations and navigates on selection", async ({ page }) => {
  const location = page.getByTestId("navigation-result");
  await expect(location).toHaveText("Location: /harness");
  await page.getByRole("button", { name: "Open command palette" }).click();
  const dialog = page.getByRole("dialog", { name: "Jump to a page" });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("textbox", { name: "Search pages" });
  await search.fill("Overview");
  const result = dialog.getByRole("button", { name: /Overview/ }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(dialog).toBeHidden();
  await expect(location).toHaveText("Location: /");

  // Outside the application shell there is no selected organization, so organization pages use the `current` alias.
  await page.getByRole("button", { name: "Open command palette" }).click();
  await search.fill("Changesets");
  await dialog.getByRole("button", { name: /Changesets/ }).click();
  await expect(dialog).toBeHidden();
  await expect(location).toHaveText("Location: /orgs/current/changesets");
});
