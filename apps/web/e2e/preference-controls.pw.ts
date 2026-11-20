import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test("mobile preference cards and rows work by label and keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: "dark" });
  await installApiMocks(page);
  await page.route("**/users/me/preferences", route => route.fulfill({
    json: { theme: "auto", language: "en-US", timezone: "UTC" },
  }));
  let notifications = {
    email_notifications: { evaluation_complete: true, review_assigned: false, changeset_status: true, org_invitation: false },
    web_push_enabled: false,
    notification_frequency: "real-time",
  };
  await page.route("**/users/me/notification-preferences", route => {
    if (route.request().method() === "PATCH") notifications = route.request().postDataJSON();
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
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await page.getByText("Review assigned", { exact: true }).click();
  await page.getByLabel("Enable web push").check();
  await page.getByRole("radio", { name: "Real-time", exact: true }).press("ArrowDown");
  await save.click();
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Review assigned" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Enable web push" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Hourly digest" })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});
