import { expect, test } from "@playwright/test";
import type { RepositoryRefRule } from "../src/shared/api/identity";
import { demoOrganization, installApiMocks, now } from "./support/api-mocks";
import { selectOption } from "./support/select-option";

const repository = "easyhaloo/agentforge";
const settingsPath = `/orgs/demo/repositories/${repository}/settings`;
const apiPath = `**/api/v1/organizations/${demoOrganization.id}/repositories/${repository}`;

test("Rulesets validates, saves, reloads, edits and removes a rule when refs cannot load", async ({ page }, testInfo) => {
  await installApiMocks(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  let rules: RepositoryRefRule[] | undefined;
  let updatedAt = now;
  let writes = 0;
  const branchRule: RepositoryRefRule = {
    name: "Release refs", target: "branch", enabled: true, include: ["release/**", "~DEFAULT_BRANCH"],
    exclude: ["release/internal/*"], restrict_creation: false, restrict_update: false, restrict_deletion: true, block_force_push: true,
  };
  const tagRule: RepositoryRefRule = {
    ...branchRule, name: "Release tags", target: "tag", include: ["release/**"], enabled: false, block_force_push: false,
  };
  await page.route(`${apiPath}/refs`, route => route.fulfill({ status: 503 }));
  await page.route(`${apiPath}/settings`, async route => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ json: { slug: repository, hosting_kind: "hosted", ref_rules: rules, updated_at: updatedAt } });
      return;
    }
    expect(request.method()).toBe("PATCH");
    const body = request.postDataJSON();
    const expected = writes < 2 ? [branchRule] : writes === 2 ? [tagRule] : [];
    expect(body).toEqual({ ref_rules: expected, updated_at: updatedAt });
    if (++writes === 1) {
      await route.fulfill({ status: 500 });
      return;
    }
    rules = expected;
    updatedAt = new Date(Date.parse(updatedAt) + 1000).toISOString();
    await route.fulfill({ json: { slug: repository, hosting_kind: "hosted", ref_rules: rules, updated_at: updatedAt } });
  });

  await page.goto(settingsPath);
  const nav = page.getByRole("navigation", { name: `Settings for ${repository}` });
  const link = nav.getByRole("link", { name: "Rulesets", exact: true });
  expect(await nav.getByRole("link").allTextContents()).toEqual(["General", "Rulesets", "Branches", "Tags", "Actions"]);
  await link.press("Enter");
  await expect(page).toHaveURL(`${settingsPath}/rulesets`);
  await expect(link).toHaveAttribute("aria-current", "page");
  const panel = page.getByRole("region", { name: "Rulesets", exact: true });
  await expect(panel.getByRole("heading", { name: "Rulesets", level: 1 })).toBeVisible();
  await expect(panel.getByText("No rulesets configured.")).toBeVisible();
  const add = panel.getByRole("button", { name: "New ruleset" });
  const save = panel.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();
  await add.press("Enter");
  const name = panel.getByRole("textbox", { name: "Ruleset name" });
  const include = panel.getByRole("textbox", { name: "Include patterns" });
  await expect(name).toBeFocused();
  await save.click();
  await expect(panel.getByRole("alert")).toHaveText("Enter a ruleset name.");
  await expect(panel.getByRole("alert")).toBeFocused();
  await name.fill(" Release refs ");
  await expect(include).toHaveAccessibleDescription(/~ALL.*~DEFAULT_BRANCH/);
  await save.click();
  await expect(panel.getByRole("alert")).toHaveText("Enter at least one include pattern.");
  await include.fill("release/**\n\n ~DEFAULT_BRANCH ");
  const exclude = panel.getByRole("textbox", { name: "Exclude patterns" });
  await exclude.fill(Array.from({ length: 9 }, (_, index) => `release/exclude-${index}`).join("\n"));
  await save.click();
  await expect(panel.getByRole("alert")).toHaveText("Use up to 10 include and exclude patterns combined.");
  await exclude.fill("release/internal/*");
  await save.click();
  await expect(panel.getByRole("alert")).toHaveText("Select at least one restriction.");
  await panel.getByRole("checkbox", { name: "Restrict deletion" }).check();
  await panel.getByRole("checkbox", { name: "Block force pushes" }).check();
  await save.press("Enter");
  await expect(panel.getByRole("alert")).toHaveText("The server ran into a problem.");
  await expect(name).toHaveValue(" Release refs ");
  await save.click();
  await expect(panel.getByRole("status")).toHaveText("Rulesets saved.");
  await expect(save).toBeDisabled();

  await page.reload();
  await expect(panel.getByRole("heading", { name: "Release refs" })).toBeVisible();
  await add.click();
  await name.fill("release REFS");
  await save.click();
  await expect(panel.getByRole("alert")).toHaveText("Ruleset names must be unique, regardless of capitalization.");
  await panel.getByRole("button", { name: "Remove release REFS", exact: true }).click();
  await expect(add).toBeFocused();
  await panel.getByRole("button", { name: "Edit Release refs", exact: true }).click();
  await expect(name).toHaveValue("Release refs");
  await page.screenshot({ path: testInfo.outputPath("repo-settings-rulesets.png"), animations: "disabled", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("repo-settings-rulesets-mobile.png"), animations: "disabled", fullPage: true });
  await selectOption(page, panel.getByRole("combobox", { name: "Target" }), "Tags");
  const blockForcePushes = panel.getByRole("checkbox", { name: "Block force pushes" });
  await expect(blockForcePushes).toBeChecked();
  await blockForcePushes.uncheck();
  await name.fill("Release tags");
  await include.fill("release/**");
  await panel.getByRole("checkbox", { name: "Enable ruleset" }).uncheck();
  await save.click();
  await expect(panel.getByRole("status")).toHaveText("Rulesets saved.");
  await expect(panel.getByText("Tags · Disabled")).toBeVisible();
  await panel.getByRole("button", { name: "Remove Release tags" }).click();
  await expect(add).toBeFocused();
  await save.click();
  await expect(panel.getByRole("status")).toHaveText("Rulesets saved.");
  await page.reload();
  await expect(panel.getByText("No rulesets configured.")).toBeVisible();
  expect(writes).toBe(4);
});

test("a registered repository shows its hosting eligibility", async ({ page }) => {
  await installApiMocks(page);
  await page.route(`${apiPath}/refs`, route => route.fulfill({ status: 503 }));
  await page.route(`${apiPath}/settings`, route => route.fulfill({ json: { slug: repository, hosting_kind: "registered", updated_at: now } }));
  await page.goto(`${settingsPath}/rulesets`);
  const panel = page.getByRole("region", { name: "Rulesets", exact: true });
  await expect(panel.getByText("Rulesets can be managed only for natively hosted repositories.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "New ruleset" })).toHaveCount(0);
});
