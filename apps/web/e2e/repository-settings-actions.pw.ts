import { expect, test } from "@playwright/test";
import { demoOrganization, installApiMocks, now } from "./support/api-mocks";
import { selectOption } from "./support/select-option";

const repository = "easyhaloo/agentforge";
const settingsPath = `/orgs/demo/repositories/${repository}/settings`;
const apiPath = `**/api/v1/organizations/${demoOrganization.id}/repositories/${repository}`;
const refs = { repository, default_branch: "main", resolved_commit_sha: "a".repeat(40), items: [] };

test("repository Actions settings save both choices and reload the persisted policy", async ({ page }, testInfo) => {
  await installApiMocks(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  let actionsDisabled: boolean | undefined;
  let updatedAt = now;
  let rejectNextSave = true;
  await page.route(`${apiPath}/refs`, route => route.fulfill({ json: refs }));
  await page.route(`${apiPath}/settings`, async route => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ json: { slug: repository, actions_disabled: actionsDisabled, updated_at: updatedAt } });
      return;
    }
    expect(request.method()).toBe("PATCH");
    const body = request.postDataJSON();
    expect(body).toEqual({ actions_disabled: !(actionsDisabled ?? false), updated_at: updatedAt });
    if (rejectNextSave) {
      rejectNextSave = false;
      await route.fulfill({ status: 500 });
      return;
    }
    actionsDisabled = body.actions_disabled;
    updatedAt = new Date(Date.parse(updatedAt) + 1000).toISOString();
    await route.fulfill({ json: { slug: repository, actions_disabled: actionsDisabled, updated_at: updatedAt } });
  });

  await page.goto(settingsPath);
  const link = page.getByRole("navigation", { name: `Settings for ${repository}` }).getByRole("link", { name: "Actions" });
  await link.press("Enter");
  await expect(page).toHaveURL(`${settingsPath}/actions`);
  await expect(link).toHaveAttribute("aria-current", "page");
  const panel = page.getByRole("region", { name: "Actions", exact: true });
  await expect(panel.getByRole("heading", { name: "Actions", level: 1 })).toBeVisible();
  const choices = panel.getByRole("combobox", { name: "Actions availability" });
  const save = panel.getByRole("button", { name: "Save", exact: true });
  await expect(choices).toHaveText(/Enable Actions/);
  await expect(save).toBeDisabled();

  await choices.press("Enter");
  const enabled = page.getByRole("option", { name: "Enable Actions" });
  await expect(enabled).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(choices).toBeFocused();
  await expect(choices).toHaveText(/Disable Actions/);
  await save.press("Enter");
  await expect(panel.getByRole("alert")).toHaveText("The server ran into a problem.");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.getByRole("status")).toHaveText("Actions settings saved.");
  await expect(save).toBeDisabled();

  await page.reload();
  await expect(choices).toHaveText(/Disable Actions/);
  await page.screenshot({ path: testInfo.outputPath("repo-settings-actions.png"), animations: "disabled", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("repo-settings-actions-mobile.png"), animations: "disabled", fullPage: true });

  await selectOption(page, choices, "Enable Actions");
  await save.click();
  await expect(panel.getByRole("status")).toHaveText("Actions settings saved.");
  await page.reload();
  await expect(choices).toHaveText(/Enable Actions/);
});

test("repository members can read Actions settings without editing them", async ({ page }) => {
  await installApiMocks(page, { organizations: [{ ...demoOrganization, role: "member" }] });
  await page.route(`${apiPath}/refs`, route => route.fulfill({ status: 503 }));
  await page.route(`${apiPath}/settings`, route => route.fulfill({ json: { slug: repository, actions_disabled: true, updated_at: now } }));
  await page.goto(`${settingsPath}/actions`);
  const panel = page.getByRole("region", { name: "Actions", exact: true });
  const choices = panel.getByRole("combobox", { name: "Actions availability" });
  await expect(choices).toHaveText(/Disable Actions/);
  await expect(choices).toBeDisabled();
  await expect(panel.getByText("Only organization owners and administrators can manage repository settings.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
});
