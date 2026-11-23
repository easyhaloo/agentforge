import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { openNavigation } from "./support/navigation";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
test.skip(!origin, "Requires the local Go API and PostgreSQL");

async function register(page: Page, displayName: string) {
  const password = randomUUID();
  await page.goto(`${origin}/register`);
  await page.locator('[name=email]').fill(`${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill(displayName);
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  return new URL(page.url()).pathname.replace(/\/changesets$/, "");
}

test("select a member mention in the composer, preview and publish it", async ({ page, browser }) => {
  const organization = await register(page, "Mention QA");
  const other = await browser.newPage();
  try {
    await register(other, "Outside member");
  } finally {
    await other.close();
  }

  await page.goto(`${origin}${organization}/repositories/new`);
  await page.getByLabel("Repository name", { exact: true }).fill("mention-walkthrough");
  await page.getByRole("switch", { name: /Add a README/ }).press("Space");
  await page.getByRole("button", { name: "Create repository", exact: true }).click();
  await expect(page).toHaveURL(/\/repositories\/[^/]+\/mention-walkthrough$/);
  const repositoryURL = page.url();
  await page.getByRole("link", { name: "Issues", exact: true }).last().click();
  await page.getByRole("link", { name: "New issue", exact: true }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Verify organization member mention");
  const body = page.getByRole("textbox", { name: "Description", exact: true });
  const options = page.getByRole("listbox", { name: "Member suggestions" });
  const isLookup = (url: string) => new URL(url).pathname.endsWith("/issues/member-mentions");

  const empty = page.waitForResponse((response) => isLookup(response.url()) && new URL(response.url()).searchParams.get("q") === "Outside");
  await body.fill("@Outside");
  expect(await (await empty).json()).toEqual({ items: [] });
  await expect(page.getByText("No suggestions found.")).toBeVisible();
  await body.press("Escape");
  await expect(body).toHaveValue("@Outside");
  await expect(page.getByText("No suggestions found.")).toHaveCount(0);
  await body.fill("Please email qa@Mention");
  await expect(options).toHaveCount(0);

  const matched = page.waitForResponse((response) => isLookup(response.url()) && new URL(response.url()).searchParams.get("q") === "Mention");
  await body.fill("Please ask @Mention");
  const response = await matched;
  expect(response.status()).toBe(200);
  const payload = await response.json() as { items: Array<{ username: string; display_name: string }> };
  expect(payload.items).toEqual([{ username: expect.stringMatching(/^member-\d+$/), display_name: "Mention QA" }]);
  const mention = `@${payload.items[0].username}`;
  await expect(options.getByRole("option", { name: `${mention} Mention QA` })).toBeVisible();
  await body.press("Enter");
  await expect(body).toHaveValue(`Please ask ${mention} `);
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByRole("tabpanel", { name: "Preview" })).toContainText(`Please ask ${mention}`);
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(page).toHaveURL(`${repositoryURL}/issues/1`);
  await page.reload();
  await expect(page.getByText(`Please ask ${mention}`, { exact: true })).toBeVisible();
});

// The fixture only sets up memberships. Issue creation and notification reads go through the browser.
const psql = process.env.AGENTFORGE_TEST_PSQL;

test("notifies only the mentioned member on publish and persists read state", async ({ page, browser }) => {
  test.skip(!psql, "Requires a psql fixture command for the local test database");
  const organization = await register(page, "Issue Author");
  const [recipient, codeOnly, suspended, outside] = await Promise.all(Array.from({ length: 4 }, () => browser.newPage()));
  try {
    const displayNames = ["Issue Recipient", "Code Example", "Suspended Member", "Outside Member"];
    const accounts = [recipient, codeOnly, suspended, outside];
    const personalOrganizations = await Promise.all(accounts.map((account, index) => register(account, displayNames[index])));
    const userID = async (account: Page) => {
      const { user_id: id } = await account.evaluate(async () => (await fetch("/api/v1/me")).json() as Promise<{ user_id: string }>);
      expect(id).toMatch(/^[a-f0-9]{32}$/);
      return id;
    };
    const [authorID, recipientID, codeOnlyID, suspendedID, outsideID] = await Promise.all([page, ...accounts].map(userID));
    const organizationID = organization.split("/").at(-1);
    expect(organizationID).toMatch(/^[a-f0-9]{32}$/);
    const handles = execFileSync(psql!, ["-XqAt", "-v", "ON_ERROR_STOP=1"], {
      input: `INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES
        ('${organizationID}', '${recipientID}', 'viewer', 'active'),
        ('${organizationID}', '${codeOnlyID}', 'viewer', 'active'),
        ('${organizationID}', '${suspendedID}', 'member', 'suspended');
        SELECT username FROM users WHERE id IN ('${authorID}', '${recipientID}', '${codeOnlyID}', '${suspendedID}', '${outsideID}')
        ORDER BY array_position(ARRAY['${authorID}', '${recipientID}', '${codeOnlyID}', '${suspendedID}', '${outsideID}'], id);`,
      encoding: "utf8",
    }).trim().split("\n");
    expect(handles).toEqual(Array(5).fill(expect.stringMatching(/^member-\d+$/)));
    const [authorHandle, recipientHandle, codeHandle, suspendedHandle, outsideHandle] = handles;

    await page.goto(`${origin}${organization}/repositories/new`);
    await page.getByLabel("Repository name", { exact: true }).fill("notification-walkthrough");
    await page.getByRole("switch", { name: /Add a README/ }).press("Space");
    await page.getByRole("button", { name: "Create repository", exact: true }).click();
    await expect(page).toHaveURL(/\/repositories\/[^/]+\/notification-walkthrough$/);
    const repositoryURL = page.url();
    await page.getByRole("link", { name: "Issues", exact: true }).last().click();
    await page.getByRole("link", { name: "New issue", exact: true }).click();
    const title = "Verify mention delivery";
    await page.getByRole("textbox", { name: "Title" }).fill(title);
    const body = page.getByRole("textbox", { name: "Description", exact: true });
    await body.fill("Please ask @Recipient");
    await page.getByRole("option", { name: `@${recipientHandle} Issue Recipient` }).click();
    await expect(body).toHaveValue(`Please ask @${recipientHandle} `);
    await body.fill(`Please ask @${recipientHandle} and **@${recipientHandle.toUpperCase()}**.\n\n` +
      `Self @${authorHandle}, outside @${outsideHandle}, suspended @${suspendedHandle}.\n\n` +
      `Contact person@${codeHandle}.test or read \`@${codeHandle}\`.\n\n\`\`\`text\n@${codeHandle}\n\`\`\``);
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(page.getByRole("tabpanel", { name: "Preview" })).toContainText(`Please ask @${recipientHandle}`);

    const inbox = `${origin}${organization}/notifications`;
    await recipient.goto(`${repositoryURL}/issues`);
    await (await openNavigation(recipient)).getByRole("link", { name: "Inbox", exact: true }).click();
    await expect(recipient).toHaveURL(inbox);
    await expect(recipient.getByText("No notifications yet.")).toBeVisible();

    await page.getByRole("button", { name: "Create issue" }).click();
    await expect(page).toHaveURL(`${repositoryURL}/issues/1`);
    await recipient.reload();
    const inboxList = recipient.getByRole("region", { name: "Inbox" });
    await expect(inboxList.getByText(/Mentioned you · Unread/)).toBeVisible();
    await expect(inboxList.getByRole("listitem")).toHaveCount(1);
    await inboxList.getByRole("link", { name: title }).click();
    await expect(recipient).toHaveURL(page.url());
    await expect(recipient.getByRole("heading", { name: title })).toBeVisible();
    await recipient.goto(inbox);
    await recipient.reload();
    await expect(inboxList.getByText(/Mentioned you · Read/)).toBeVisible();

    const otherInboxes: [Page, string][] = [
      [page, inbox], [codeOnly, inbox],
      [suspended, `${origin}${personalOrganizations[2]}/notifications`],
      [outside, `${origin}${personalOrganizations[3]}/notifications`],
    ];
    await Promise.all(otherInboxes.map(async ([account, url]) => {
      await account.goto(url);
      await expect(account.getByText("No notifications yet.")).toBeVisible();
    }));
    for (const unauthorized of [suspended, outside]) {
      const status = await unauthorized.evaluate(async (id) => (await fetch(`/api/v1/organizations/${id}/notifications`)).status, organizationID);
      expect(status).toBe(401);
    }
  } finally {
    await Promise.all([recipient, codeOnly, suspended, outside].map((account) => account.close()));
  }
});
