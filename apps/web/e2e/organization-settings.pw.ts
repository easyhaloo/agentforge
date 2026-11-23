import { expect, test } from "@playwright/test";
import { demoOrganization, installApiMocks } from "./support/api-mocks";

const api = `**/api/v1/organizations/${demoOrganization.id}`;
const joined = "2026-01-02T12:00:00Z";

test("organization settings keep role and action menus usable at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await installApiMocks(page);
  let member = { user_id: "user-member", display_name: "Taylor Member", email: "taylor@example.test", role: "member", status: "active", created_at: joined, updated_at: joined };
  await page.route(`${api}/members?*`, (route) => route.fulfill({ json: { items: [member] } }));
  await page.route(`${api}/members/${member.user_id}`, (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toEqual({ role: "viewer" });
    member = { ...member, role: "viewer" };
    return route.fulfill({ json: member });
  });
  await page.route(`${api}/invitations?*`, (route) => route.fulfill({ json: { items: [] } }));
  await page.route(`${api}/membership-audit?*`, (route) => route.fulfill({ json: { items: [] } }));

  await page.goto("/orgs/demo/settings");
  await expect(page.getByRole("heading", { level: 1, name: demoOrganization.name })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Audit history" })).toBeInViewport({ ratio: 1 });
  const row = page.getByRole("row", { name: /Taylor Member/ });
  await expect(row.getByText("Active", { exact: true }).filter({ visible: true })).toBeVisible();
  const role = row.getByRole("combobox", { name: "Role for Taylor Member" });
  await role.press("Enter");
  await expect(page.getByRole("option", { name: "Member", selected: true })).toBeFocused();
  await expect(page.getByRole("option", { name: "Viewer" })).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(role).toBeFocused();
  await role.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Viewer" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(role).toHaveText(/Viewer/);

  const actions = row.getByRole("button", { name: "Actions for Taylor Member" });
  await actions.press("Enter");
  const menu = page.getByRole("dialog", { name: "Actions for Taylor Member" });
  await expect(menu.getByRole("button", { name: "Suspend member" })).toBeFocused();
  await expect(menu).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  await actions.click();
  await menu.getByRole("button", { name: "Remove member" }).click();
  const confirmation = page.getByRole("dialog", { name: "Remove organization member?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Invite member" }).click();
  await expect(page.getByRole("tab", { name: /Invitations/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Email address" })).toBeFocused();
  await page.getByRole("combobox", { name: "Role", exact: true }).click();
  await expect(page.getByRole("option", { name: "Admin" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("organization members see the restricted settings state without admin controls", async ({ page }) => {
  await installApiMocks(page, { organizations: [{ ...demoOrganization, role: "member" }] });
  await page.goto("/orgs/demo/settings");
  await expect(page.getByRole("heading", { name: "Organization administration restricted" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Organization administration" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Invite member" })).toHaveCount(0);
});
