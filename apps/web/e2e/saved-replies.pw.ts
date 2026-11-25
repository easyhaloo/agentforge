import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
const repliesAPI = "/api/v1/users/me/saved-replies";
test.skip(!origin, "Requires the local Go API and PostgreSQL");

async function register(page: Page) {
  const password = randomUUID();
  await page.goto(`${origin}/register`);
  await page.locator('[name=email]').fill(`saved-reply-${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill("Saved Reply QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  return new URL(page.url()).pathname.replace(/\/changesets$/, "");
}

test("manage personal saved replies and publish an inserted reply through the issue composer", async ({ page, browser }) => {
  test.setTimeout(60_000);
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(new URL(origin!).hostname);
  const organization = await register(page);
  await page.getByRole("button", { name: /^User menu,/ }).click();
  await page.getByRole("dialog", { name: "User menu" }).getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Saved replies", exact: true }).click();
  await expect(page.getByText("You don’t have any saved replies yet.")).toBeVisible();
  const replyTitle = page.getByRole("textbox", { name: "Reply title" });
  const replyBody = page.getByRole("textbox", { name: "Reply body" });
  const saveReply = page.getByRole("button", { name: "Save reply" });
  await replyTitle.fill("   ");
  await replyBody.fill("**Initial checklist**");
  await expect(saveReply).toBeDisabled();
  await replyTitle.fill("Triage checklist");

  const simulateFailure = () => page.route(`**${repliesAPI}`, (route) => route.fulfill({ status: 503 }), { times: 1 });
  await simulateFailure();
  await saveReply.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(replyTitle).toHaveValue("Triage checklist");
  await expect(replyBody).toHaveValue("**Initial checklist**");
  const created = page.waitForResponse((res) => res.url().endsWith(repliesAPI) && res.request().method() === "POST");
  await saveReply.click();
  expect((await created).status()).toBe(201);
  await page.reload();
  await page.getByRole("button", { name: "Edit Triage checklist" }).click();
  await expect(replyBody).toHaveValue("**Initial checklist**");
  await replyBody.fill("**Collect logs**");
  const updated = page.waitForResponse((res) => res.url().includes(`${repliesAPI}/`) && res.request().method() === "PATCH");
  await saveReply.click();
  expect((await updated).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Add a saved reply" })).toBeVisible();

  const other = await browser.newContext();
  try {
    const viewer = await other.newPage();
    await register(viewer);
    await viewer.goto(`${origin}/settings/saved-replies`);
    await expect(viewer.getByText("You don’t have any saved replies yet.")).toBeVisible();
    await expect(viewer.getByText("Triage checklist")).toHaveCount(0);
  } finally {
    await other.close();
  }

  await page.goto(`${origin}${organization}/repositories/new`);
  await page.getByLabel("Repository name", { exact: true }).fill("reply-walkthrough");
  await page.getByRole("switch", { name: /Add a README/ }).press("Space");
  await page.getByRole("button", { name: "New repository", exact: true }).click();
  await expect(page).toHaveURL(/\/repositories\/[^/]+\/reply-walkthrough$/);
  const repositoryURL = page.url();
  await page.getByRole("link", { name: "Issues", exact: true }).last().click();
  await page.getByRole("link", { name: "New issue", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Title" });
  const body = page.getByRole("textbox", { name: "Description", exact: true });
  await title.fill("Verify saved reply in published issue");
  await body.fill("Before DROP after");
  await body.press("ControlOrMeta+A");
  await body.press("ArrowLeft");
  for (let i = 0; i < 7; i++) await body.press("ArrowRight");
  for (let i = 0; i < 4; i++) await body.press("Shift+ArrowRight");
  expect(await body.evaluate((field: HTMLTextAreaElement) => field.value.slice(field.selectionStart, field.selectionEnd))).toBe("DROP");
  const repliesURL = `**${repliesAPI}`;
  await page.route(repliesURL, (route) => route.fulfill({ status: 503 }));
  const picker = page.getByRole("dialog", { name: "Saved replies" });
  await page.getByRole("button", { name: "Saved replies", exact: true }).click();
  await expect(picker.getByRole("alert")).toHaveText("Could not load saved replies.");
  await page.unroute(repliesURL);
  await picker.getByRole("button", { name: "Retry" }).click();
  const filter = picker.getByRole("textbox", { name: "Filter saved replies" });
  await filter.fill("no such reply");
  await expect(picker.getByText("No matching saved replies.")).toBeVisible();
  await filter.fill("CHECKLIST");
  await picker.getByRole("button", { name: "Triage checklist" }).click();
  await expect(body).toHaveValue("Before **Collect logs** after");
  await expect(body).toBeFocused();

  const fullDraft = "x".repeat(65536);
  await body.fill(fullDraft);
  await page.getByRole("button", { name: "Saved replies", exact: true }).click();
  await picker.getByRole("button", { name: "Triage checklist" }).click();
  await expect(picker.getByRole("alert")).toHaveText("This reply would exceed the issue description limit.");
  await page.keyboard.press("Escape");
  await expect(body).toHaveValue(fullDraft);

  await body.fill("\n");
  await body.pressSequentially("/saved-replies");
  await body.press("Enter");
  await picker.getByRole("button", { name: "Triage checklist" }).click();
  await expect(body).toHaveValue("\n**Collect logs**");
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByRole("tabpanel", { name: "Preview" }).locator("strong")).toHaveText("Collect logs");
  await page.getByRole("button", { name: "New issue" }).click();
  await expect(page).toHaveURL(`${repositoryURL}/issues/1`);
  await page.reload();
  await expect(page.locator("strong").getByText("Collect logs", { exact: true })).toBeVisible();

  await page.goto(`${origin}/settings/saved-replies`);
  await page.getByRole("button", { name: "Delete Triage checklist" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Triage checklist" });
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete Triage checklist" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Triage checklist" }).click();
  const deleted = page.waitForResponse((res) => res.url().includes(`${repliesAPI}/`) && res.request().method() === "DELETE");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  expect((await deleted).status()).toBe(204);
  await page.reload();
  await expect(page.getByText("You don’t have any saved replies yet.")).toBeVisible();
  await page.goto(`${repositoryURL}/issues/new`);
  await page.getByRole("button", { name: "Saved replies", exact: true }).click();
  await expect(picker.getByText("You don’t have any saved replies yet.")).toBeVisible();
  await expect(picker.getByRole("link", { name: /Manage saved replies/ })).toHaveAttribute("href", "/settings/saved-replies");
});
