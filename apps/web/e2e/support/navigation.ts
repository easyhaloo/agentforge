import { expect, type Page } from "@playwright/test";

export const navigationToggle = (page: Page) => page.getByRole("button", { name: "Open navigation" });
export const navigation = (page: Page) => page.getByRole("navigation", { name: "Global navigation" });

export async function openNavigation(page: Page) {
  const drawer = page.locator(".af-drawer");
  await expect(page.locator(".af-drawer:not(.af-drawer--visible)")).toHaveCount(0);

  if (!(await navigation(page).isVisible())) await navigationToggle(page).click();

  await expect(navigation(page)).toBeVisible();
  if (await drawer.count()) {
    await expect(drawer).toHaveClass(/af-drawer--visible/);
    await expect(drawer).toHaveCSS("transform", /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  }

  return navigation(page);
}
