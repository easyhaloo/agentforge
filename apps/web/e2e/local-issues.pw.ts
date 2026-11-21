import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
const gitRoot = process.env.GIT_REPOSITORY_ROOT ?? join(process.env.RUN_DIR ?? "/tmp/agentforge-dev", "git");
test.skip(!origin, "Requires a local API, PostgreSQL, and the dev stack Git root");

test("repository issues persist create, edit, close and reopen through the API", async ({ page }, testInfo) => {
  const base = new URL(origin!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(base.hostname);
  const password = randomUUID();
  await page.goto(`${base.origin}/register`);
  await page.locator('[name=email]').fill(`issues-${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill("Issues QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  const organizationPath = new URL(page.url()).pathname.replace(/\/changesets$/, "");
  // Use Chromium's same-origin session cookies, as the app does.
  const me = await page.evaluate(async () => {
    const response = await fetch("/api/v1/me", { credentials: "include" });
    return {
      status: response.status,
      account: await response.json() as { organizations: Array<{ id: string }> },
    };
  });
  expect(me.status).toBe(200);
  const { organizations } = me.account;
  expect(organizations).toHaveLength(1);
  const orgID = organizations[0].id;
  expect(orgID).toMatch(/^[a-zA-Z0-9_-]+$/);

  // The registration API verifies a real default branch under the tenant's configured Git root.
  const ownerDir = join(gitRoot, orgID, "issues-qa");
  mkdirSync(ownerDir, { recursive: true });
  const gitDir = mkdtempSync(join(ownerDir, "repo-"));
  const repository = `issues-qa/${basename(gitDir)}`;
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", gitDir, ...args], {
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    git("init", "--quiet", "--initial-branch=main", "--template=");
    writeFileSync(join(gitDir, "README.md"), "# Issues QA\n");
    git("add", "README.md");
    git("-c", "user.name=Issues QA", "-c", "user.email=issues@example.test", "commit", "--quiet", "-m", "Seed repository");

    const repositoriesAPI = `/api/v1/organizations/${orgID}/repositories`;
    const issuesAPI = `/api/v1/organizations/${orgID}/issues`;
    const issuesPath = `${organizationPath}/repositories/${repository}/issues`;
    const apiResponse = (path: string, method: string) => page.waitForResponse(response =>
      new URL(response.url()).pathname === path && response.request().method() === method,
    );

    await page.goto(`${base.origin}${organizationPath}/repositories`);
    await page.getByRole("button", { name: "Register repository" }).click();
    const register = page.getByRole("dialog", { name: "Register repository" });
    await register.getByLabel("Repository slug").fill(repository);
    const registered = apiResponse(repositoriesAPI, "POST");
    await register.getByRole("button", { name: "Register", exact: true }).click();
    expect((await registered).status()).toBe(201);
    await page.getByRole("link", { name: repository, exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${organizationPath}/repositories/${repository}`);
    await page.getByRole("link", { name: "Issues", exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${issuesPath}`);
    await expect(page.getByText("No issues found matching your filters.")).toBeVisible();

    const title = "Preserve issue state after reload";
    const description = "Verify this issue is stored by the real API.";
    await page.getByRole("button", { name: "New issue", exact: true }).click();
    const create = page.getByRole("dialog", { name: "New issue" });
    await create.getByLabel("Title").fill(title);
    await create.getByLabel("Description").fill(description);
    const created = apiResponse(issuesAPI, "POST");
    await create.getByRole("button", { name: "Create issue", exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const issue = await createdResponse.json() as { number: number; repository: string; state: string };
    expect(issue).toMatchObject({ number: 1, repository, state: "open" });
    const detailAPI = `${issuesAPI}/${issue.number}`;
    const detail = page.getByRole("dialog");
    await expect(detail).toHaveAccessibleName(`${title} #${issue.number}`);
    await expect(detail.getByText(description, { exact: true })).toBeVisible();

    const updatedTitle = `${title} (edited)`;
    await detail.getByRole("button", { name: "Edit issue" }).click();
    await detail.getByLabel("Title").fill(updatedTitle);
    const updated = apiResponse(detailAPI, "PATCH");
    await detail.getByRole("button", { name: "Save changes" }).click();
    expect((await updated).status()).toBe(200);
    await expect(detail).toHaveAccessibleName(`${updatedTitle} #${issue.number}`);

    const closed = apiResponse(`${detailAPI}/close`, "POST");
    await detail.getByRole("button", { name: "Close issue", exact: true }).click();
    const closedResponse = await closed;
    expect(closedResponse.status()).toBe(200);
    expect(await closedResponse.json()).toMatchObject({ state: "closed", state_reason: "completed" });
    await expect(detail.getByRole("button", { name: "Reopen issue" })).toBeVisible();

    await page.reload();
    await expect(page.getByText("No issues found matching your filters.")).toBeVisible();
    const list = apiResponse(issuesAPI, "GET");
    await page.getByRole("button", { name: /^Closed issues\b/i }).click();
    const listResponse = await list;
    expect(new URL(listResponse.url()).searchParams.get("state")).toBe("closed");
    expect(await listResponse.json()).toMatchObject({ total: 1, items: [{ title: updatedTitle, state: "closed" }] });
    const issueRow = page.getByRole("button", { name: updatedTitle, exact: true });
    await expect(issueRow).toBeVisible();
    const screenshot = async (name: string) => {
      const path = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path, animations: "disabled", fullPage: true });
      await testInfo.attach(name, { path, contentType: "image/png" });
    };
    await screenshot("issues-closed-list-real-api");

    const reloaded = apiResponse(detailAPI, "GET");
    await issueRow.click();
    expect(await (await reloaded).json()).toMatchObject({ number: issue.number, title: updatedTitle, state: "closed" });
    const reopen = detail.getByRole("button", { name: "Reopen issue", exact: true });
    await expect(reopen).toBeVisible();
    await screenshot("issue-closed-detail-real-api");
    const reopened = apiResponse(`${detailAPI}/reopen`, "POST");
    await reopen.click();
    const reopenedResponse = await reopened;
    expect(reopenedResponse.status()).toBe(200);
    expect(await reopenedResponse.json()).toMatchObject({ state: "open" });
    await expect(detail.getByRole("button", { name: "Close issue", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Open issues\b/i }).click();
    await expect(issueRow).toBeVisible();
    const search = page.getByPlaceholder("Search issues...");
    await search.fill("does not exist");
    await expect(page.getByText("No issues found matching your filters.")).toBeVisible();
    await search.fill(updatedTitle);
    await expect(issueRow).toBeVisible();
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
});
