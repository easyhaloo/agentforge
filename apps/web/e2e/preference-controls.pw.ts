import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test("mobile preference cards and rows work by label and keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await installApiMocks(page);
  await page.route("**/users/me/preferences", route => route.fulfill({
    json: { theme: "auto", language: "en-US", timezone: "UTC" },
  }));
  let notifications = { inbox_participating: true, inbox_watching: true };
  let failSave = false;
  await page.route("**/users/me/notification-preferences", route => {
    if (route.request().method() === "PATCH") {
      if (failSave) return route.abort();
      notifications = { ...notifications, ...route.request().postDataJSON() };
    }
    return route.fulfill({ json: notifications });
  });

  await page.goto("/settings/appearance");
  const theme = page.getByRole("group", { name: "Theme", exact: true });
  await theme.getByText("Light", { exact: true }).click();
  await theme.getByRole("radio", { name: "Light" }).press("ArrowRight");
  await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

  await page.goto("/settings/notifications");
  const participating = page.getByRole("checkbox", { name: "Show participating notifications in the inbox" });
  const watching = page.getByRole("checkbox", { name: "Show watching notifications in the inbox" });
  await expect(participating).toBeChecked();
  await participating.press("Space");
  await expect(participating).not.toBeChecked();
  await page.reload();
  await expect(participating).toBeVisible();
  await expect(participating).not.toBeChecked();
  await expect(watching).toBeChecked();

  failSave = true;
  await watching.click();
  await expect(page.getByText("Unable to save notification preferences")).toBeVisible();
  await expect(watching).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});
