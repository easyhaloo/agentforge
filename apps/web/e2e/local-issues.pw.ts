import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
const gitRoot = process.env.GIT_REPOSITORY_ROOT ?? join(process.env.RUN_DIR ?? "/tmp/agentforge-dev", "git");
test.skip(!origin, "Requires a local API, PostgreSQL, and the dev stack Git root");

test("creates, edits, closes, and reopens an issue across reloads", async ({ page }, testInfo) => {
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
      account: await response.json() as { organizations: Array<{ id: string; slug: string; personal?: boolean }> },
    };
  });
  expect(me.status).toBe(200);
  const { organizations } = me.account;
  expect(organizations).toHaveLength(1);
  const orgID = organizations[0].id;
  expect(orgID).toMatch(/^[a-zA-Z0-9_-]+$/);

  expect(organizations[0].personal).toBe(true);
  const ownerHandle = organizations[0].slug || orgID;
  const newRepo = "starter-repository";
  const newSlug = `${ownerHandle}/${newRepo}`;
  const newGitDir = join(gitRoot, orgID, ownerHandle, newRepo);
  const newPath = `${organizationPath}/repositories/new`;
  const repositoryList = `/api/v1/organizations/${orgID}/repositories`;
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${base.origin}${newPath}`);
  await expect(page.getByRole("button", { name: "Issues QA", exact: true })).toBeVisible();
  await page.getByLabel("Repository name", { exact: true }).fill(newRepo);
  await page.getByLabel("Description (optional)").fill("Verified with PostgreSQL and Git");
  await page.getByRole("switch", { name: /Add a README/ }).press("Space");
  await page.getByRole("button", { name: "No .gitignore", exact: true }).click();
  await page.getByRole("option", { name: "Node", exact: true }).click();
  await page.getByRole("button", { name: "No license", exact: true }).click();
  await page.getByRole("option", { name: "MIT", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("repository-create-real.png"), fullPage: true, animations: "disabled" });
  const createdRepository = page.waitForResponse(response => new URL(response.url()).pathname === repositoryList && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create repository", exact: true }).click();
  const result = await createdRepository;
  expect(result.status(), await result.text()).toBe(201);
  expect(await result.json()).toMatchObject({ organization_id: orgID, slug: newSlug, default_branch: "main", visibility: "private", fork: false, description: "Verified with PostgreSQL and Git" });
  await expect(page).toHaveURL(`${base.origin}${organizationPath}/repositories/${newSlug}`);
  const gitFiles = execFileSync("git", ["-C", newGitDir, "ls-tree", "--name-only", "HEAD"], { encoding: "utf8" });
  expect(gitFiles.trim().split("\n")).toEqual([".gitignore", "LICENSE", "README.md"]);
  await expect(page.getByRole("link", { name: "README.md", exact: true })).toBeVisible();
  await page.goto(`${base.origin}${newPath}`);
  await page.getByLabel("Repository name", { exact: true }).fill(newRepo);
  await expect(page.getByText(/repository name.*already taken/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create repository", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("repository-create-duplicate.png"), fullPage: true, animations: "disabled" });

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
    await page.getByRole("link", { name: "New repository", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Create a new repository" })).toBeVisible();
    await page.getByRole("link", { name: "Register an existing repository" }).click();
    await page.getByLabel("Owner", { exact: true }).fill("issues-qa");
    const name = page.getByLabel("Repository name", { exact: true });
    const submit = page.getByRole("button", { name: "Register repository", exact: true });
    await name.fill(`${basename(gitDir)}-missing`);
    const missing = apiResponse(repositoriesAPI, "POST");
    await submit.click();
    expect((await missing).status()).toBe(422);
    await expect(page.getByRole("alert").filter({ hasText: /repository must exist/i })).toBeVisible();
    await expect(name).toHaveValue(`${basename(gitDir)}-missing`);
    await name.fill(basename(gitDir));
    await page.getByRole("combobox", { name: "Visibility" }).click();
    await page.getByRole("option", { name: "Private repository" }).click();
    await page.getByRole("checkbox", { name: "Forked repository" }).check();
    const registered = apiResponse(repositoriesAPI, "POST");
    await submit.click();
    const registeredResponse = await registered;
    expect(registeredResponse.status()).toBe(201);
    expect(await registeredResponse.json()).toMatchObject({ slug: repository, visibility: "private", fork: true });
    await expect(page).toHaveURL(`${base.origin}${organizationPath}/repositories/${repository}`);
    await page.getByRole("link", { name: "Issues", exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${issuesPath}`);
    await expect(page.getByText("No issues found matching your filters.")).toBeVisible();

    const title = "Preserve issue state after reload";
    const description = "Verify this issue is stored by the real API.";
    await page.getByRole("button", { name: "New issue", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Create issue" });
    await create.getByLabel("Title").fill(title);
    await create.getByLabel("Description").fill(description);
    const created = apiResponse(issuesAPI, "POST");
    await create.getByRole("button", { name: "Create issue", exact: true }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const issue = await createdResponse.json() as { number: number; repository: string; state: string };
    expect(issue).toMatchObject({ number: 1, repository, state: "open" });
    const detailAPI = `${issuesAPI}/${issue.number}`;
    await expect(page).toHaveURL(`${base.origin}${issuesPath}/${issue.number}`);
    await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Issue", exact: true })).toHaveCount(0);
    await expect(page.getByText(description, { exact: true })).toBeVisible();

    const updatedTitle = `${title} (edited)`;
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit issue" });
    await edit.getByLabel("Title").fill(updatedTitle);
    const updated = apiResponse(detailAPI, "PATCH");
    await edit.getByRole("button", { name: "Update issue", exact: true }).click();
    expect((await updated).status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Preserve issue state after reload.*edited/ })).toBeVisible();

    await page.getByRole("button", { name: "Close issue", exact: true }).click();
    const closed = apiResponse(`${detailAPI}/close`, "POST");
    await page.getByRole("dialog", { name: "Close issue" }).getByRole("button", { name: "Close issue", exact: true }).click();
    const closedResponse = await closed;
    expect(closedResponse.status()).toBe(200);
    expect(closedResponse.request().postDataJSON()).toEqual({ reason: "completed" });
    const reopen = page.getByRole("button", { name: "Reopen issue", exact: true });
    await expect(reopen).toBeVisible();

    const reloaded = apiResponse(detailAPI, "GET");
    await page.reload();
    const reloadedResponse = await reloaded;
    expect(reloadedResponse.status()).toBe(200);
    expect(await reloadedResponse.json()).toMatchObject({ number: issue.number, title: updatedTitle, state: "closed", state_reason: "completed" });
    await expect(reopen).toBeVisible();
    const closedScreenshot = testInfo.outputPath("issue-closed-real-api.png");
    await page.screenshot({ path: closedScreenshot, animations: "disabled", fullPage: true });
    await testInfo.attach("Closed issue after reload", { path: closedScreenshot, contentType: "image/png" });

    await page.getByRole("link", { name: "Back to issues", exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${issuesPath}`);
    await expect(page.getByText("No issues found matching your filters.")).toBeVisible();
    await page.getByRole("button", { name: /^Closed issues\b/i }).click();
    const closedIssue = page.getByRole("link", { name: updatedTitle, exact: true });
    await expect(closedIssue).toBeVisible();
    await expect(closedIssue).toHaveAttribute("href", `${issuesPath}/${issue.number}`);
    const closedListScreenshot = testInfo.outputPath("issues-closed-list-real-api.png");
    await page.screenshot({ path: closedListScreenshot, animations: "disabled" });
    await testInfo.attach("Issue in the Closed list", { path: closedListScreenshot, contentType: "image/png" });

    await closedIssue.click();
    const reopened = apiResponse(`${detailAPI}/reopen`, "POST");
    await reopen.click();
    const reopenedResponse = await reopened;
    expect(reopenedResponse.status()).toBe(200);
    expect(await reopenedResponse.json()).toMatchObject({ state: "open" });
    await expect(page.getByRole("button", { name: "Close issue", exact: true })).toBeVisible();
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
});
