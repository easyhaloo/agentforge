import { type Page } from "@playwright/test";

export const navigationToggle = (page: Page) => page.getByRole("button", { name: "Open navigation" });
export const navigation = (page: Page) => page.getByRole("navigation", { name: "Global navigation" });

export async function openNavigation(page: Page) {
  if (!(await navigation(page).isVisible())) await navigationToggle(page).click();
  return navigation(page);
}
