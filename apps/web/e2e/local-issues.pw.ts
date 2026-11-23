import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { StoredChangeset } from "../src/shared/api/identity";
import { openNavigation } from "./support/navigation";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
const gitRoot = process.env.GIT_REPOSITORY_ROOT ?? join(process.env.RUN_DIR ?? "/tmp/agentforge-dev", "git");
test.skip(!origin, "Requires a local API, PostgreSQL, and the dev stack Git root");
test.use({ actionTimeout: 8000 });

test("register a repository, commit a Changeset revision and complete an Issue through the UI", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  const base = new URL(origin!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(base.hostname);
  const email = `issues-${randomUUID()}@example.test`;
  const password = randomUUID();
  await page.goto(`${base.origin}/register`);
  await page.locator('[name=email]').fill(email);
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
      encoding: "utf8",
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    git("init", "--quiet", "--initial-branch=main", "--template=");
    const initialContent = "# Issues QA\n";
    writeFileSync(join(gitDir, "README.md"), initialContent);
    git("add", "README.md");
    git("-c", "user.name=Issues QA", "-c", "user.email=issues@example.test", "commit", "--quiet", "-m", "Seed repository");

    const api = `/api/v1/organizations/${orgID}`;
    const repositoriesAPI = `${api}/repositories`;
    const changesetsAPI = `${api}/changesets`;
    const issuesAPI = `${api}/issues`;
    const repositoryPath = `${organizationPath}/repositories/${repository}`;
    const apiResponse = (path: string, method: string, tab = page) => tab.waitForResponse(response =>
      new URL(response.url()).pathname === path && response.request().method() === method,
    { timeout: 8000 });
    const screenshot = async (name: string) => {
      const path = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path, animations: "disabled", fullPage: true });
      await testInfo.attach(name, { path, contentType: "image/png" });
    };
    const source = (tab: Page) => tab.getByRole("textbox", { name: "File content" });
    const save = (tab: Page) => tab.getByRole("button", { name: "Save revision" });
    const openReadme = (tab: Page) => tab.getByRole("button", { name: "README.md", exact: true }).click();
    const initialSHA = git("rev-parse", "main").trim();
    const committedContent = `${initialContent}\nEdited in WebIDE.\n`;

    const registerPage = async () => {
      await page.getByRole("link", { name: "New repository", exact: true }).click();
      await page.getByRole("link", { name: "Register an existing repository" }).click();
    };

    await test.step("REG-01 to REG-04: reject invalid registration, register main, reject duplicate", async () => {
      await (await openNavigation(page)).getByRole("link", { name: "Repositories", exact: true }).click();
      await registerPage();
      const owner = page.getByLabel("Owner", { exact: true });
      const name = page.getByLabel("Repository name", { exact: true });
      const branch = page.getByLabel("Default branch", { exact: true });
      const submit = page.getByRole("button", { name: "Register repository", exact: true });
      await name.fill(basename(gitDir));
      await owner.fill("");
      await submit.click();
      await expect(page.getByText("Owner cannot contain spaces or forward slashes.")).toBeVisible();
      await owner.fill("issues-qa");
      await expect(branch).toHaveValue("main");
      await branch.fill("missing-branch");
      const rejected = apiResponse(repositoriesAPI, "POST");
      await submit.click();
      const rejectedResponse = await rejected;
      expect(rejectedResponse.status()).toBe(422);
      expect(await rejectedResponse.json()).toMatchObject({ title: "Repository not available" });
      await expect(page.getByRole("alert")).toHaveText("The repository must exist on this server and the default branch must resolve.");
      await expect(name).toHaveValue(basename(gitDir));
      await branch.fill("main");
      await page.getByRole("combobox", { name: "Visibility" }).click();
      await page.getByRole("option", { name: "Private repository" }).click();
      await page.getByRole("checkbox", { name: "Forked repository" }).check();
      const registered = apiResponse(repositoriesAPI, "POST");
      await submit.click();
      const registeredResponse = await registered;
      expect(registeredResponse.status()).toBe(201);
      expect(await registeredResponse.json()).toMatchObject({ slug: repository, visibility: "private", fork: true });
      await expect(page).toHaveURL(`${base.origin}${repositoryPath}`);
      await expect(page.getByRole("link", { name: "README.md", exact: true })).toBeVisible();
      await screenshot("repository-registered");

      await (await openNavigation(page)).getByRole("link", { name: "Repositories", exact: true }).click();
      await registerPage();
      await owner.fill("issues-qa");
      await name.fill(basename(gitDir));
      await expect(page.getByText(/repository name.*already taken/i)).toBeVisible();
      await expect(submit).toBeDisabled();
      await page.getByRole("link", { name: "Cancel", exact: true }).click();
      const repositoryLink = page.getByRole("link", { name: repository, exact: true });
      await expect(repositoryLink).toHaveCount(1);
      await repositoryLink.click();
    });

    await test.step("CODE-01: browsing a repository without a Changeset is read-only", async () => {
      await page.getByRole("link", { name: "Open WebIDE", exact: true }).click();
      await openReadme(page);
      await expect(source(page)).toHaveValue(initialContent);
      await expect(source(page)).toBeDisabled();
      await expect(save(page)).toBeDisabled();
    });

    const changeset = await test.step("CODE-02: create a Changeset, add main and open its initial Revision", async () => {
      await (await openNavigation(page)).getByRole("link", { name: "Changesets", exact: true }).click();
      const title = "Update README through WebIDE";
      await page.getByLabel("Title", { exact: true }).fill(title);
      const repositoryPicker = page.getByRole("combobox", { name: "Repository", exact: true });
      await repositoryPicker.click();
      await page.getByRole("option", { name: `${repository} · main`, exact: true }).click();
      await expect(repositoryPicker).toContainText(repository);
      const creating = apiResponse(changesetsAPI, "POST");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      const response = await creating;
      expect(response.status()).toBe(201);
      const { changeset: created } = await response.json() as StoredChangeset;
      expect(created.repository).toBe(repository);
      await page.getByRole("link", { name: title, exact: true }).click();
      const detailsURL = page.url();
      const sections = page.getByRole("navigation", { name: "Changeset sections" });
      await sections.getByRole("link", { name: "Revisions" }).click();
      await page.getByPlaceholder("branch, tag or commit SHA").fill("main");
      const adding = apiResponse(`${changesetsAPI}/${created.id}/revisions`, "POST");
      await page.getByRole("button", { name: "Add revision" }).click();
      const result = await adding;
      expect(result.status()).toBe(200);
      const { changeset: withRevision } = await result.json() as StoredChangeset;
      expect(withRevision.revisions).toMatchObject([{ commit_sha: initialSHA }]);
      await sections.getByRole("link", { name: "Overview" }).click();
      await page.getByRole("link", { name: "View files in WebIDE" }).click();
      await openReadme(page);
      await expect(source(page)).toBeEditable();
      await expect(source(page)).toHaveValue(initialContent);
      await expect(save(page)).toBeDisabled();
      await expect(page).toHaveURL(/path=README\.md/);
      return { id: created.id, initialRevision: withRevision.revisions[0], detailsURL };
    });

    let committedSHA = "";
    const staleTab = await context.newPage();
    try {
      await staleTab.goto(page.url());
      await expect(source(staleTab)).toHaveValue(initialContent);
      await expect(source(staleTab)).toBeEditable();
      const filesAPI = `${changesetsAPI}/${changeset.id}/files`;

      committedSHA = await test.step("CODE-03: keep the draft, save a Git commit and check persisted Revision", async () => {
        await source(page).fill(committedContent);
        await page.getByRole("button", { name: "Reset", exact: true }).click();
        const discard = page.getByRole("dialog", { name: "Discard unsaved changes?" });
        await discard.getByRole("button", { name: "Cancel" }).click();
        await expect(source(page)).toHaveValue(committedContent);
        const saving = apiResponse(filesAPI, "PUT");
        await save(page).click();
        const saved = await saving;
        expect(saved.status()).toBe(200);
        const { commit_sha: sha, branch, changeset: stored } = await saved.json() as {
          commit_sha: string; branch: string; changeset: StoredChangeset;
        };
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
        expect(sha).not.toBe(initialSHA);
        expect(stored.changeset.id).toBe(changeset.id);
        expect(stored.changeset.revisions).toMatchObject([
          { id: changeset.initialRevision.id, commit_sha: initialSHA }, { commit_sha: sha },
        ]);
        expect(stored.changeset.revisions[1].id).not.toBe(changeset.initialRevision.id);
        expect(git("rev-parse", branch).trim()).toBe(sha);
        expect(git("rev-parse", `${sha}^`).trim()).toBe(initialSHA);
        expect(git("rev-parse", "main").trim()).toBe(initialSHA);
        expect(git("show", `${sha}:README.md`)).toBe(committedContent);

        await page.goto(changeset.detailsURL);
        const sections = page.getByRole("navigation", { name: "Changeset sections" });
        await sections.getByRole("link", { name: "Revisions" }).click();
        await expect(page.getByText(initialSHA)).toContainText(sha);
        await screenshot("changeset-persisted-git-revision");
        return sha;
      });

      await test.step("CODE-04: reject stale save, preserve its draft and recover the current commit", async () => {
        const staleContent = `${initialContent}\nStale tab edit.\n`;
        await source(staleTab).fill(staleContent);
        const rejected = apiResponse(filesAPI, "PUT", staleTab);
        await save(staleTab).click();
        const response = await rejected;
        expect(response.status()).toBe(409);
        expect(await response.json()).toMatchObject({ title: "Stale editor revision" });
        await expect(staleTab.getByRole("alert")).toHaveText("That conflicts with the current state.");
        await expect(source(staleTab)).toHaveValue(staleContent);
        await staleTab.goto(changeset.detailsURL);
        const webide = staleTab.getByRole("link", { name: "View files in WebIDE" });
        await expect(webide).toHaveAttribute("href", new RegExp(committedSHA));
        await webide.click();
        await openReadme(staleTab);
        await expect(source(staleTab)).toHaveValue(committedContent);
      });
    } finally {
      await staleTab.close();
    }

    await (await openNavigation(page)).getByRole("link", { name: "Repositories", exact: true }).click();
    await page.getByRole("link", { name: repository, exact: true }).click();
    await page.getByRole("navigation", { name: "Repository sections" }).getByRole("link", { name: "Issues", exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${repositoryPath}/issues`);
    const empty = page.getByText("No issues found matching your filters.");
    await expect(empty).toBeVisible();

    const issuesPath = `${repositoryPath}/issues`;
    const createPath = `${issuesPath}/new`;
    const newIssue = page.getByRole("link", { name: "New issue", exact: true });
    const titleInput = page.getByRole("textbox", { name: "Title" });
    const descriptionInput = page.getByRole("textbox", { name: "Description" });
    const create = page.getByRole("button", { name: /^Create issue\b/i });
    const write = page.getByRole("tab", { name: "Write", exact: true });
    const preview = page.getByRole("tab", { name: "Preview", exact: true });

    await test.step("ISSUE-01: empty preview, blank title and discard without publishing", async () => {
      await newIssue.click();
      await expect(page).toHaveURL(`${base.origin}${createPath}`);
      await expect(titleInput).toBeFocused();
      await expect(create).toBeDisabled();
      await preview.click();
      await expect(page.getByText(/nothing to preview/i)).toBeVisible();
      await write.click();
      await titleInput.fill("   ");
      await expect(create).toBeDisabled();
      await descriptionInput.fill("Unpublished draft");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      const discard = page.getByRole("dialog");
      await discard.getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect(descriptionInput).toHaveValue("Unpublished draft");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await discard.getByRole("button", { name: /discard/i }).click();
      await expect(page).toHaveURL(`${base.origin}${issuesPath}`);
      await expect(empty).toBeVisible();
    });

    const title = "Preserve issue state after reload";
    const description = [
      "    Leading code indentation",
      "",
      "## Verified description",
      "",
      "**Real API** with `Markdown`.",
      "Second line :rocket:",
      "",
      "- [x] Preview matches detail",
      "",
      "> [!TIP]",
      "> Use a native disclosure.",
      "",
      "<details>",
      "<summary>Details after publish</summary>",
      "",
      "Hidden until expanded.",
      "",
      "</details>",
    ].join("\n");
    const verifyMarkdown = async () => {
      const rendered = page.locator(".issue-markdown");
      await expect(rendered.getByRole("heading", { name: "Verified description", exact: true })).toBeVisible();
      await expect(rendered.locator("p:has(> br)")).toHaveText(/Real API with Markdown\.\s*Second line 🚀/);
      await expect(rendered.getByRole("checkbox")).toBeChecked();
      await expect(rendered.getByText("Tip", { exact: true })).toBeVisible();
      const hidden = rendered.getByText("Hidden until expanded.", { exact: true });
      await expect(hidden).toBeHidden();
      await rendered.getByText("Details after publish", { exact: true }).click();
      await expect(hidden).toBeVisible();
    };
    const issue = await test.step("ISSUE-02: preview a draft and persist its Markdown with the real API", async () => {
      await page.goto(`${base.origin}${createPath}`);
      await expect(titleInput).toBeFocused();
      await titleInput.fill(title);
      await descriptionInput.fill(description);
      await preview.click();
      await verifyMarkdown();
      await screenshot("issue-markdown-preview");
      await write.click();
      await expect(descriptionInput).toHaveValue(description);
      const pending = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await pending;
      expect(response.status()).toBe(201);
      const created = await response.json() as { number: number; repository: string; state: string; body: string };
      expect(created).toMatchObject({ number: 1, repository, state: "open", body: description });
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/${created.number}`);
      await page.reload();
      await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
      await verifyMarkdown();
      await expect(page.locator("pre code")).toHaveText("Leading code indentation");
      return created;
    });

    await test.step("ISSUE-03: edit, close, reload, reopen and search for the persisted issue", async () => {
      const detailAPI = `${issuesAPI}/${issue.number}`;
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
      await screenshot("issue-closed-real-api");

      await page.getByRole("link", { name: "Back to issues", exact: true }).click();
      await expect(page).toHaveURL(`${base.origin}${issuesPath}`);
      await expect(page.getByText("No issues found matching your filters.")).toBeVisible();
      await page.getByRole("button", { name: /^Closed issues\b/i }).click();
      const closedIssue = page.getByRole("link", { name: updatedTitle, exact: true });
      await expect(closedIssue).toBeVisible();
      await expect(closedIssue).toHaveAttribute("href", `${issuesPath}/${issue.number}`);
      await screenshot("issues-closed-list-real-api");

      await closedIssue.click();
      const reopened = apiResponse(`${detailAPI}/reopen`, "POST");
      await reopen.click();
      const reopenedResponse = await reopened;
      expect(reopenedResponse.status()).toBe(200);
      expect(await reopenedResponse.json()).toMatchObject({ state: "open" });
      await expect(page.getByRole("button", { name: "Close issue", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Back to issues", exact: true }).click();
      const search = page.getByRole("textbox", { name: "Search issues" }).or(page.getByPlaceholder("Search issues..."));
      await search.fill("not present");
      await expect(empty).toBeVisible();
      await search.fill(updatedTitle);
      await expect(page.getByRole("link", { name: updatedTitle, exact: true })).toBeVisible();
      await search.clear();
    });

    await test.step("ISSUE-04: create more persists both issues without leaving the form between submissions", async () => {
      await newIssue.click();
      const createMore = page.getByRole("checkbox", { name: "Create more" });
      await createMore.check();
      await titleInput.fill("First follow-up");
      await descriptionInput.fill("Draft to reset");
      const first = apiResponse(issuesAPI, "POST");
      await titleInput.press("Control+Enter");
      expect((await first).status()).toBe(201);
      await expect(page).toHaveURL(`${base.origin}${createPath}`);
      await expect(titleInput).toHaveValue("");
      await expect(titleInput).toBeFocused();
      await expect(descriptionInput).toHaveValue("");
      await expect(createMore).toBeChecked();
      await createMore.uncheck();
      await titleInput.fill("Second follow-up");
      await descriptionInput.fill("See #1 and GH-2. Unknown #34999999 and literal `#1`.");
      const verifyIssueReferences = async () => {
        const rendered = page.locator(".issue-markdown");
        await expect(rendered.getByRole("link", { name: "#1", exact: true })).toHaveAttribute("href", `${issuesPath}/1`);
        await expect(rendered.getByRole("link", { name: "GH-2", exact: true })).toHaveAttribute("href", `${issuesPath}/2`);
        await expect(rendered.getByRole("link", { name: "#34999999", exact: true })).toHaveCount(0);
        await expect(rendered.locator("code")).toHaveText("#1");
      };
      await preview.click();
      await verifyIssueReferences();
      await page.locator(".issue-markdown").getByRole("link", { name: "#1", exact: true }).click();
      const discard = page.getByRole("dialog");
      await expect(discard.getByRole("button", { name: "Keep editing", exact: true })).toBeVisible();
      await discard.getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect(page).toHaveURL(`${base.origin}${createPath}`);
      await verifyIssueReferences();
      const second = apiResponse(issuesAPI, "POST");
      await create.click();
      expect((await second).status()).toBe(201);
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/3`);
      await page.reload();
      await verifyIssueReferences();
      await page.getByRole("link", { name: "Back to issues", exact: true }).click();
      await expect(page.getByRole("link", { name: "First follow-up", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Second follow-up", exact: true })).toBeVisible();
    });

    await test.step("ISSUE-05: keep the draft on failure and send only one request per retry", async () => {
      await newIssue.click();
      await titleInput.fill("Retry once");
      await descriptionInput.fill("Draft survives request failure");
      let attempts = 0;
      let releaseFirst: () => void = () => {};
      const firstRequestHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
      await page.route(`**${issuesAPI}`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        attempts += 1;
        if (attempts === 1) {
          await firstRequestHeld;
          await route.fulfill({ status: 503, json: { title: "Service unavailable" } });
        } else {
          await route.continue();
        }
      });
      const failed = apiResponse(issuesAPI, "POST");
      try {
        await create.click();
        await expect.poll(() => attempts).toBe(1);
        await expect(titleInput).toBeDisabled();
        await expect(page.getByRole("button", { name: "Loading…" })).toBeDisabled();
        await page.keyboard.press("Control+Enter");
      } finally {
        releaseFirst();
      }
      expect((await failed).status()).toBe(503);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(titleInput).toHaveValue("Retry once");
      await expect(descriptionInput).toHaveValue("Draft survives request failure");
      const retried = apiResponse(issuesAPI, "POST");
      await create.click();
      expect((await retried).status()).toBe(201);
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/4`);
      expect(attempts).toBe(2);
    });

    await test.step("ISSUE-08: persist metadata and recover from a deleted option without losing the draft", async () => {
      // Set up catalog options via their real APIs. Issue creation is driven only by the form.
      const repositoryAPI = `${repositoriesAPI}/${repository}`;
      const catalogRequest = (path: string, method: string, data?: Record<string, string>) => page.evaluate(async (input) => {
        const csrf = document.cookie.match(/(?:^|; )__Host-agentforge_csrf=([^;]+)/)?.[1];
        if (!csrf) throw new Error("No browser CSRF cookie for fixture request");
        const response = await fetch(input.path, {
          method: input.method,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) },
          body: JSON.stringify(input.data),
        });
        const json = response.status === 204 ? undefined : await response.json() as { ID: string };
        return { status: response.status, id: json?.ID };
      }, { path, method, data });
      const ready = await catalogRequest(`${repositoryAPI}/labels`, "POST", { name: "Ready for QA", color: "cceeff" });
      const stale = await catalogRequest(`${repositoryAPI}/labels`, "POST", { name: "Temporary QA label", color: "cceeff" });
      const milestone = await catalogRequest(`${repositoryAPI}/milestones`, "POST", { title: "QA release" });
      expect(ready.status).toBe(201);
      expect(stale.status).toBe(201);
      expect(milestone.status).toBe(201);
      expect(stale.id).toBeTruthy();

      await page.getByRole("link", { name: "Back to issues", exact: true }).click();
      await newIssue.click();
      await titleInput.fill("Issue with metadata");
      await descriptionInput.fill("Keep this draft on validation failure.");
      const metadata = page.getByRole("button", { name: /^Issue metadata/ });
      const picker = page.getByRole("dialog", { name: "Issue metadata" });
      const assignYourself = page.getByRole("button", { name: "Assign yourself", exact: true });
      await assignYourself.click();
      await expect(assignYourself).toBeHidden();
      await expect(metadata).toHaveText("Issue metadata (1)");
      await metadata.click();
      await picker.getByRole("radio", { name: "Bug", exact: true }).check();
      await expect(picker.getByRole("checkbox", { name: "Issues QA", exact: true })).toBeChecked();
      await picker.getByRole("checkbox", { name: "Ready for QA", exact: true }).check();
      await picker.getByRole("checkbox", { name: "Temporary QA label", exact: true }).check();
      await picker.getByRole("radio", { name: "QA release", exact: true }).check();
      await page.keyboard.press("Escape");
      await expect(metadata).toHaveText("Issue metadata (5)");

      const removed = await catalogRequest(`${repositoryAPI}/labels/${encodeURIComponent("Temporary QA label")}`, "DELETE");
      expect(removed.status).toBe(204);
      const rejected = apiResponse(issuesAPI, "POST");
      await create.click();
      expect((await rejected).status()).toBe(422);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(descriptionInput).toHaveValue("Keep this draft on validation failure.");
      await metadata.click();
      const unavailableLabel = picker.getByRole("checkbox", { name: new RegExp(stale.id!) });
      await unavailableLabel.click();
      await expect(picker.getByRole("radio", { name: "Bug", exact: true })).toBeChecked();
      await expect(unavailableLabel).toHaveCount(0);
      await page.keyboard.press("Escape");

      const saved = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await saved;
      expect(response.status()).toBe(201);
      expect(await response.json()).toMatchObject({
        number: 5, issue_type: "bug", labels: [{ name: "Ready for QA" }], assignees: [{ display_name: "Issues QA" }], milestone_title: "QA release",
      });
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/5`);
      await page.reload();
      for (const name of ["Bug", "Ready for QA", "QA release"]) {
        await expect(page.getByText(name, { exact: true })).toBeVisible();
      }
      await expect(page.locator(".issue-sidebar-section").filter({ has: page.getByRole("heading", { name: "Assignees", exact: true }) }).getByText("Issues QA", { exact: true })).toBeVisible();
    });

    await test.step("FILE-01 to FILE-04, FILE-06 and FILE-07: upload, preview, reject invalid files and publish persisted attachments", async () => {
      await page.goto(`${base.origin}${createPath}`);
      const title = "Attachments from the Issue composer";
      await titleInput.fill(title);
      const uploadAPI = `${api}/issue-attachments`;
      const attachButton = page.getByRole("button", { name: "Attach files" });
      async function choose(files: Parameters<import("@playwright/test").FileChooser["setFiles"]>[0]) {
        const chooser = page.waitForEvent("filechooser");
        await attachButton.click();
        await (await chooser).setFiles(files);
      }
      const malformed = apiResponse(uploadAPI, "POST");
      await choose({ name: "unsupported.exe", mimeType: "application/octet-stream", buffer: Buffer.from("invalid") });
      expect((await malformed).status()).toBe(415);
      await expect(page.getByRole("alert")).toContainText("unsupported.exe");
      await choose({ name: "too-large.png", mimeType: "image/png", buffer: Buffer.alloc((10 << 20) + 1) });
      await expect(page.getByRole("alert")).toContainText("exceeds the attachment size limit");
      await expect(titleInput).toHaveValue(title);

      let failUpload = true;
      let resumeUpload!: () => void;
      const uploadGate = new Promise<void>((resolve) => { resumeUpload = resolve; });
      await page.route(`**${uploadAPI}?*`, async (route) => {
        if (failUpload) {
          failUpload = false;
          await uploadGate;
          await route.fulfill({ status: 503, json: { title: "Temporary failure" } });
        } else {
          await route.continue();
        }
      });
      const text = { name: "notes [QA].txt", mimeType: "text/plain", buffer: Buffer.from("Persisted attachment\n") };
      try {
        await choose(text);
        await expect(descriptionInput).toBeDisabled();
        await expect(create).toBeDisabled();
      } finally {
        resumeUpload();
      }
      await expect(page.getByRole("alert")).toContainText("Choose the file again to retry");
      await choose(text);
      await expect(descriptionInput).toHaveValue(/notes.*\.txt\]\(.*issue-attachments/);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.unroute(`**${uploadAPI}?*`);

      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Je0AAAAASUVORK5CYII=";
      const [imageResponse] = await Promise.all([
        apiResponse(uploadAPI, "POST"),
        descriptionInput.evaluate((field, data) => {
          const clipboardData = new DataTransfer();
          clipboardData.items.add(new File([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], "preview.png", { type: "image/png" }));
          clipboardData.setData("text/uri-list", "https://example.test/preview.png");
          field.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
        }, png),
      ]);
      expect(imageResponse.status()).toBe(201);
      const image = await imageResponse.json() as { id: string; url: string };
      await expect(descriptionInput).toHaveValue(/!\[preview\.png\]/);
      await expect(descriptionInput).not.toHaveValue(/https:\/\/example\.test\/preview\.png/);

      const bodyBeforePreviewUpload = await descriptionInput.inputValue();
      await preview.click();
      const svgUploaded = apiResponse(uploadAPI, "POST");
      const svgRead = page.waitForResponse((response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname.startsWith(`${uploadAPI}/`) &&
        response.headers()["content-type"]?.startsWith("image/svg+xml"),
      { timeout: 8000 });
      await choose({
        name: "preview.svg", mimeType: "image/svg+xml",
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>'),
      });
      const svgResponse = await svgUploaded;
      expect(svgResponse.status()).toBe(201);
      const svg = await svgResponse.json() as { url: string };
      const svgPreviewResponse = await svgRead;
      expect(new URL(svgPreviewResponse.url()).pathname).toBe(svg.url);
      expect(svgPreviewResponse.headers()["content-security-policy"]).toContain("sandbox");
      const previewSVG = page.getByRole("img", { name: "preview.svg" });
      await expect(previewSVG).toHaveJSProperty("naturalWidth", 16);
      await page.getByRole("tab", { name: "Write" }).click();
      expect((await descriptionInput.inputValue()).trimEnd()).toBe(`${bodyBeforePreviewUpload.trimEnd()}\n![preview.svg](${svg.url})`);
      const invalidVideo = apiResponse(uploadAPI, "POST");
      await choose({ name: "invalid.webm", mimeType: "video/webm", buffer: Buffer.from("invalid") });
      expect((await invalidVideo).status()).toBe(422);
      await expect(page.getByRole("alert")).toContainText("invalid.webm");

      const videos = [["webm", "video/webm"], ["mp4", "video/mp4"], ["mov", "video/quicktime"]].map(([extension, mimeType]) => {
        const name = `issue-preview.${extension}`;
        return { name, mimeType, buffer: readFileSync(new URL(`./fixtures/${name}`, import.meta.url)) };
      });
      for (const file of videos) {
        const uploaded = apiResponse(uploadAPI, "POST");
        await choose(file);
        expect((await uploaded).status()).toBe(201);
        await expect(descriptionInput).toHaveValue(new RegExp(file.name));
      }
      const verifyPlayback = async () => {
        for (const { name } of videos) {
          const player = page.getByLabel(name, { exact: true });
          await expect(player).toBeVisible();
          // Bundled Chromium can omit H.264. Downloads are verified for every format below.
          if (!name.endsWith(".webm") && !await player.evaluate((element: HTMLVideoElement) => element.canPlayType('video/mp4; codecs="avc1.64000a"'))) continue;
          await expect(player).toHaveJSProperty("videoWidth", 32);
          await player.evaluate((element: HTMLVideoElement) => element.play());
          await expect(player).toHaveJSProperty("paused", false);
          await player.evaluate((element: HTMLVideoElement) => element.pause());
        }
      };

      const [droppedResponse] = await Promise.all([
        apiResponse(uploadAPI, "POST"),
        descriptionInput.evaluate((field) => {
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(new File(["unreferenced"], "remove.txt", { type: "text/plain" }));
          field.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
        }),
      ]);
      expect(droppedResponse.status()).toBe(201);
      const removed = await droppedResponse.json() as { id: string; url: string };
      await expect(descriptionInput).toHaveValue(/remove\.txt/);
      await descriptionInput.fill((await descriptionInput.inputValue()).split("\n").filter((line) => !line.includes(removed.url)).join("\n"));
      await preview.click();
      await expect(previewSVG).toHaveJSProperty("naturalWidth", 16);
      const previewImage = page.getByRole("img", { name: "preview.png" });
      await expect(previewImage).toHaveJSProperty("naturalWidth", 1);
      await verifyPlayback();
      await expect(page.getByRole("link", { name: text.name })).toBeVisible();
      await expect(page.getByRole("link", { name: "remove.txt" })).toHaveCount(0);

      await page.route(`**${issuesAPI}`, (route) => route.fulfill({ status: 503, json: { title: "Temporary failure" } }), { times: 1 });
      await create.click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(previewImage).toHaveJSProperty("naturalWidth", 1);
      const issueCreated = apiResponse(issuesAPI, "POST");
      await create.click();
      const issueResponse = await issueCreated;
      expect(issueResponse.status()).toBe(201);
      expect(issueResponse.request().postDataJSON().attachment_ids).toEqual(expect.arrayContaining([image.id]));
      expect(issueResponse.request().postDataJSON().attachment_ids).toHaveLength(6);
      const published = await issueResponse.json() as { number: number };
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/${published.number}`);
      await page.reload();
      await expect(previewSVG).toHaveJSProperty("naturalWidth", 16);
      await expect(previewImage).toHaveJSProperty("naturalWidth", 1);
      await verifyPlayback();
      for (const { name, buffer } of videos) {
        const videoDownloaded = page.waitForEvent("download");
        await page.getByRole("link", { name, exact: true }).click();
        expect(readFileSync(await (await videoDownloaded).path())).toEqual(buffer);
      }
      const downloaded = page.waitForEvent("download");
      await page.getByRole("link", { name: text.name }).click();
      const download = await downloaded;
      expect(download.suggestedFilename()).toBe(text.name);
      expect(readFileSync(await download.path())).toEqual(text.buffer);
      await screenshot("issue-persisted-attachments");
    });

    await test.step("ISSUE-09/10: prefill a draft and suggest existing issues without blocking creation", async () => {
      const description = `**Seeded through the URL.** ${"a".repeat(71)}`;
      expect(description).toHaveLength(99);
      const query = new URLSearchParams({
        title, body: description, labels: "ready for qa,Ready for QA", assignees: "Issues QA", milestone: "QA release",
      });
      await page.goto(`${base.origin}${createPath}?${query}`);
      await expect(titleInput).toHaveValue(title);
      await expect(descriptionInput).toHaveValue(description);
      await expect(page.getByRole("button", { name: "Issue metadata (3)", exact: true })).toBeVisible();
      await preview.click();
      await expect(page.getByText("Seeded through the URL.", { exact: true })).toBeVisible();
      const suggestions = page.getByRole("region", { name: "Potential duplicate issues" });
      await expect(suggestions).toBeHidden();
      await write.click();
      await descriptionInput.fill(`${description}!`);
      const existing = suggestions.getByRole("link", { name: new RegExp(`${title}.*edited`) });
      await expect(existing).toHaveAttribute("href", `${issuesPath}/${issue.number}`);
      await existing.click();
      await page.getByRole("button", { name: "Keep editing" }).click();
      await expect(descriptionInput).toHaveValue(`${description}!`);
      const created = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await created;
      expect(response.status()).toBe(201);
      const saved = await response.json() as { number: number; title: string; body: string };
      expect(saved).toMatchObject({
        title, body: `${description}!`, labels: [{ name: "Ready for QA" }],
        assignees: [{ display_name: "Issues QA" }], milestone_title: "QA release",
      });
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/${saved.number}`);
      await page.reload();
      await expect(page.getByText("Seeded through the URL.", { exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Back to issues", exact: true }).click();
    });

    await test.step("ISSUE-11: preserve the draft when URL metadata no longer exists", async () => {
      const query = new URLSearchParams({ title: "Draft from an outdated link", labels: "Temporary QA label" });
      await page.goto(`${base.origin}${createPath}?${query}`);
      await expect(page.getByRole("alert")).toHaveText("The issue fields from this link could not be applied.");
      await expect(titleInput).toHaveValue("Draft from an outdated link");
      await expect(page.getByRole("button", { name: "Issue metadata", exact: true })).toBeVisible();
      await expect(create).toBeEnabled();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Discard changes", exact: true }).click();
      await expect(page).toHaveURL(`${base.origin}${issuesPath}`);
    });

    await test.step("ISSUE-12: resolve Issue and Git references in another registered repository", async () => {
      const targetGitDir = mkdtempSync(join(ownerDir, "reference-"));
      try {
        git("clone", "--quiet", "--branch", "main", gitDir, targetGitDir);
        const targetRepository = `issues-qa/${basename(targetGitDir)}`;
        const targetPath = `${organizationPath}/repositories/${targetRepository}`;
        const targetIssues = `${targetPath}/issues`;
        await page.goto(`${base.origin}${organizationPath}/repositories`);
        await registerPage();
        await page.getByLabel("Owner", { exact: true }).fill("issues-qa");
        await page.getByLabel("Repository name", { exact: true }).fill(basename(targetGitDir));
        const registered = apiResponse(repositoriesAPI, "POST");
        await page.getByRole("button", { name: "Register repository", exact: true }).click();
        expect((await registered).status()).toBe(201);

        await page.goto(`${base.origin}${targetIssues}`);
        await newIssue.click();
        const foreignLookup = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname === changesetsAPI && url.searchParams.get("repository") === targetRepository
            && url.searchParams.get("q") === "WebIDE";
        });
        await descriptionInput.fill("#WebIDE");
        expect(await (await foreignLookup).json()).toMatchObject({ items: [] });
        await expect(page.getByText("No suggestions found.")).toBeVisible();
        await descriptionInput.fill("");
        await titleInput.fill("Reference target");
        const target = apiResponse(issuesAPI, "POST");
        await create.click();
        expect((await target).status()).toBe(201);
        await expect(page).toHaveURL(`${base.origin}${targetIssues}/1`);

        await page.goto(`${base.origin}${createPath}`);
        const qualified = `${targetRepository}#1`;
        const qualifiedCommit = `${targetRepository}@${initialSHA}`;
        const commitLink = `${targetRepository}@${initialSHA.slice(0, 7)}`;
        const commitURL = `${targetPath}?change=${initialSHA}`;
        await titleInput.fill("References in multiple repositories");
        await descriptionInput.fill(`See ${qualified}, #1 and ${qualifiedCommit}. Unknown missing/repository-#1 and literal \`${qualified}\`.`);
        await preview.click();
        const verifyLinks = async () => {
          const rendered = page.locator(".issue-markdown");
          await expect(rendered.getByRole("link", { name: qualified, exact: true })).toHaveAttribute("href", `${targetIssues}/1`);
          await expect(rendered.getByRole("link", { name: "#1", exact: true })).toHaveAttribute("href", `${issuesPath}/1`);
          await expect(rendered.getByRole("link", { name: commitLink, exact: true })).toHaveAttribute("href", commitURL);
          await expect(rendered.getByRole("link")).toHaveCount(3);
          await expect(rendered.locator("code")).toHaveText([initialSHA.slice(0, 7), qualified]);
        };
        const sameIssue = `${base.origin}${issuesPath}/1`;
        const targetIssue = `${base.origin}${targetIssues}/1`;
        const untouchedURLs = [
          `${base.origin}${targetIssues}/2147483647`,
          `${base.origin}${targetIssues.replace(organizationPath, "/orgs/another-org")}/1`,
          `https://example.com${targetIssues}/1`,
        ];
        const verifyIssueURLs = async () => {
          const rendered = page.locator(".issue-markdown p").last();
          await expect(rendered.getByRole("link", { name: "#1", exact: true })).toHaveAttribute("href", `${issuesPath}/1`);
          await expect(rendered.getByRole("link", { name: qualified, exact: true })).toHaveAttribute("href", `${targetIssues}/1#details`);
          await expect(rendered.getByRole("link", { name: "Custom issue label", exact: true })).toHaveAttribute("href", `${targetIssues}/1`);
          for (const url of untouchedURLs) {
            await expect(rendered.getByRole("link", { name: url, exact: true })).toHaveAttribute("href", url);
          }
        };
        await verifyLinks();
        await test.step("ISSUE-19: compact verified Issue URLs and preserve their destinations", async () => {
          await page.getByRole("tab", { name: "Write", exact: true }).click();
          const referenceBody = await descriptionInput.inputValue();
          await descriptionInput.fill(`${sameIssue}\n<${targetIssue}#details>\n[Custom issue label](${targetIssue})\n${untouchedURLs.join("\n")}`);
          await preview.click();
          await verifyIssueURLs();
          await page.getByRole("tab", { name: "Write", exact: true }).click();
          await descriptionInput.fill(`${referenceBody}\n\n${await descriptionInput.inputValue()}`);
          await preview.click();
          await verifyIssueURLs();
          await page.locator(".issue-markdown p").last().getByRole("link", { name: qualified, exact: true }).click();
          await page.getByRole("button", { name: "Keep editing", exact: true }).click();
          await expect(page).toHaveURL(`${base.origin}${createPath}`);
        });
        const published = apiResponse(issuesAPI, "POST");
        await create.click();
        const response = await published;
        expect(response.status()).toBe(201);
        const { number } = await response.json() as { number: number };
        await expect(page).toHaveURL(`${base.origin}${issuesPath}/${number}`);
        await page.reload();
        await verifyIssueURLs();
        await page.locator(".issue-markdown p").last().getByRole("link", { name: qualified, exact: true }).click();
        await expect(page.getByRole("heading", { name: /Reference target/ })).toBeVisible();
        await page.goBack();
        await page.getByRole("link", { name: commitLink, exact: true }).click();
        await expect(page).toHaveURL(`${base.origin}${commitURL}`);
        await expect(page.locator(".repository-diff")).toContainText("+# Issues QA");
      } finally {
        rmSync(targetGitDir, { recursive: true, force: true });
      }
    });

    await test.step("ISSUE-13: follow the Git commit produced by WebIDE from Issue Markdown", async () => {
      await page.goto(`${base.origin}${createPath}`);
      const shortSHA = committedSHA.slice(0, 7);
      const unknownSHA = "f".repeat(40);
      const commitURL = `${repositoryPath}?change=${committedSHA}`;
      const body = `Changes in ${committedSHA}, ${repository}@${committedSHA} and ${shortSHA}. Unknown ${unknownSHA}. Changeset ${changeset.id}. Literal \`${committedSHA}\`.`;
      await titleInput.fill("Link to the WebIDE commit");
      await descriptionInput.fill(body);
      await preview.click();
      const markdown = page.locator(".issue-markdown");
      const verifyLinks = async () => {
        await expect(markdown.getByRole("link", { name: shortSHA, exact: true })).toHaveCount(3);
        await expect(markdown.locator(`a[href="${commitURL}"]`)).toHaveCount(3);
        await expect(markdown.getByRole("link")).toHaveCount(3);
        await expect(markdown).toContainText(unknownSHA);
        await expect(markdown).toContainText(changeset.id);
        await expect(markdown.locator("p > code")).toHaveText(committedSHA);
      };
      await verifyLinks();
      await markdown.getByRole("link", { name: shortSHA, exact: true }).first().click();
      await page.getByRole("dialog", { name: "Discard changes?" }).getByRole("button", { name: "Keep editing" }).click();
      await expect(page).toHaveURL(`${base.origin}${createPath}`);
      await write.click();
      await expect(descriptionInput).toHaveValue(body);
      const published = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await published;
      expect(response.status()).toBe(201);
      const { number } = await response.json() as { number: number };
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/${number}`);
      await page.reload();
      await verifyLinks();
      await markdown.getByRole("link", { name: shortSHA, exact: true }).first().click();
      await expect(page).toHaveURL(`${base.origin}${commitURL}`);
      await expect(page.locator(".repo-commit-identity code")).toHaveAttribute("title", committedSHA);
    });

    await test.step("ISSUE-15: follow the parent commit to view the root commit diff", async () => {
      await page.getByRole("link", { name: new RegExp(initialSHA.slice(0, 7)) }).click();
      await expect(page).toHaveURL(`${base.origin}${repositoryPath}?change=${initialSHA}`);
      await expect(page.locator(".repository-diff")).toContainText("+# Issues QA");
    });

    await test.step("ISSUE-14: shorten pasted GitHub commit URLs without changing their targets", async () => {
      await page.goto(`${base.origin}${createPath}`);
      const githubURL = `https://github.com/${repository}/commit/${committedSHA}`;
      const diffURL = `${githubURL}#diff-example`;
      const otherHost = `https://example.com/${repository}/commit/${committedSHA}`;
      const otherRepo = `https://github.com/other/repository/commit/${committedSHA}`;
      const shortSHA = committedSHA.slice(0, 7);
      await titleInput.fill("Pasted GitHub commit URLs");
      await descriptionInput.fill(`${githubURL}\n<${diffURL}>\n[View original commit](${githubURL})\n${otherHost}\n${otherRepo}`);
      await preview.click();
      const markdown = page.locator(".issue-markdown");
      const verifyLinks = async () => {
        for (const [label, url] of [[shortSHA, githubURL], [`${shortSHA}#diff-example`, diffURL], ["View original commit", githubURL], [otherHost, otherHost], [otherRepo, otherRepo]]) {
          await expect(markdown.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", url);
        }
      };
      await verifyLinks();
      const published = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await published;
      expect(response.status()).toBe(201);
      const { number } = await response.json() as { number: number };
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/${number}`);
      await page.reload();
      await verifyLinks();
    });

    await test.step("ISSUE-16: keep preview usable when Git history is slow", async () => {
      await page.goto(`${base.origin}${createPath}`);
      const historyURL = `**/repositories/${repository}/history?limit=1&ref=${committedSHA}`;
      const stalled: Route[] = [];
      await page.route(historyURL, route => { stalled.push(route); });
      try {
        await descriptionInput.fill(`## Slow history\n\nCommit ${committedSHA}`);
        await preview.click();
        const markdown = page.locator(".issue-markdown");
        await expect(markdown.getByRole("heading", { name: "Slow history" })).toBeVisible({ timeout: 5000 });
        expect(stalled.length).toBeGreaterThan(0);
        await expect(markdown).toContainText(committedSHA);
        await expect(markdown.getByRole("link")).toHaveCount(0);
      } finally {
        await page.unroute(historyURL);
        await Promise.allSettled(stalled.map(route => route.abort()));
      }
    });

    await test.step("ISSUE-17: apply GitHub Markdown shortcuts and submit from Preview", async () => {
      await page.goto(`${base.origin}${createPath}`);
      await titleInput.fill("Markdown keyboard shortcuts");
      for (const [shortcut, expected] of [
        ["b", "**Words**"], ["i", "_Words_"], ["e", "`Words`"], ["k", "[Words](url)"],
        ["Shift+Digit7", "1. Words"], ["Shift+Digit8", "- Words"], ["Shift+Period", "> Words"],
      ]) {
        await descriptionInput.fill("Words");
        await descriptionInput.press("ControlOrMeta+a");
        await descriptionInput.press(`ControlOrMeta+${shortcut}`);
        await expect(descriptionInput).toHaveValue(expected);
      }
      await descriptionInput.fill("**Keyboard draft**");
      await descriptionInput.press("ControlOrMeta+Shift+p");
      const previewPanel = page.getByRole("tabpanel", { name: "Preview" });
      await expect(preview).toHaveAttribute("aria-selected", "true");
      await expect(previewPanel).toBeFocused();
      await expect(previewPanel.locator("strong")).toHaveText("Keyboard draft");
      await previewPanel.press("ControlOrMeta+Shift+p");
      await expect(descriptionInput).toBeFocused();
      await expect(descriptionInput).toHaveValue("**Keyboard draft**");
      await descriptionInput.press("ControlOrMeta+Shift+p");
      const published = apiResponse(issuesAPI, "POST");
      await previewPanel.press("ControlOrMeta+Enter");
      const response = await published;
      expect(response.status()).toBe(201);
      const { number } = await response.json() as { number: number };
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/${number}`);
      await page.reload();
      await expect(page.locator(".issue-markdown strong")).toHaveText("Keyboard draft");
    });

    await test.step("ISSUE-18: paste Markdown links and an HTML table without losing the draft", async () => {
      await page.goto(`${base.origin}${createPath}`);
      await titleInput.fill("Paste GitHub Markdown");
      const paste = (text: string, html?: string) => descriptionInput.evaluate((field, data) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", data.text);
        if (data.html) clipboardData.setData("text/html", data.html);
        return field.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
      }, { text, html });
      const link = "https://example.test/guide";
      const label = "Read the guide";
      await descriptionInput.fill(label);
      await descriptionInput.press("ControlOrMeta+a");
      await descriptionInput.dispatchEvent("keydown", { code: "KeyV", shiftKey: true, ctrlKey: true });
      expect(await paste(link)).toBe(true);
      await expect(descriptionInput).toHaveValue(label);
      expect(await paste(link)).toBe(false);
      const linkMarkdown = `[${label}](${link})`;
      await expect(descriptionInput).toHaveValue(linkMarkdown);
      const table = '<meta charset="utf-8"><table><tr><th>Step</th><th>Result</th></tr><tr><td>Preview</td><td>Ready</td></tr></table>';
      await page.evaluate(() => { document.execCommand = () => false; });
      const pasteTable = () => paste("Step\tResult\nPreview\tReady", table);
      const maxBody = "x".repeat(65536);
      await descriptionInput.fill(maxBody);
      await descriptionInput.press("End");
      expect(await pasteTable()).toBe(false);
      expect(await descriptionInput.inputValue() === maxBody).toBe(true);
      await descriptionInput.fill(linkMarkdown);
      await descriptionInput.press("End");
      expect(await pasteTable()).toBe(false);
      const verifyPaste = async () => {
        const markdown = page.locator(".issue-markdown");
        await expect(markdown.getByRole("link", { name: label })).toHaveAttribute("href", link);
        await expect(markdown.getByRole("table").locator("thead th").first()).toHaveText("Step");
        await expect(markdown.getByRole("cell", { name: "Ready" })).toBeVisible();
      };
      await preview.click();
      await verifyPaste();
      const published = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await published;
      expect(response.status()).toBe(201);
      const { number } = await response.json() as { number: number };
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/${number}`);
      await page.reload();
      await verifyPaste();
    });

    await test.step("ISSUE-21, ISSUE-27: resolve public GitHub URLs and shorthand in preview and after publishing", async () => {
      const pull = "https://github.com/easyhaloo/agentforge/pull/143";
      const issue = "https://github.com/cli/cli/issues/7401";
      const unknown = "https://github.com/cli/cli/issues/999999999";
      const offline = "https://github.com/cli/cli/pull/1";
      const unrelated = "https://example.test/cli/cli/issues/7401";
      const lookups: string[] = [];
      const lookupURL = `**${issuesAPI}/github-reference?*`;
      await page.route(lookupURL, async route => {
        const { searchParams } = new URL(route.request().url());
        const key = `${searchParams.get("repository")}#${searchParams.get("number")}`;
        lookups.push(key);
        if (key === "easyhaloo/agentforge#143") await route.fulfill({ json: { kind: "pull", title: "Apply account timezone", state: "merged" } });
        else if (key === "cli/cli#7401") await route.fulfill({ json: { kind: "issues", title: "Public issue title", state: "closed" } });
        else await route.fulfill({ status: key === "cli/cli#1" ? 503 : 404 });
      });
      try {
        await page.goto(`${base.origin}${createPath}`);
        await titleInput.fill("GitHub Issue and PR references");
        const extra = Array.from({ length: 5 }, (_, index) => `cli/cli#${index + 61}`);
        await descriptionInput.fill([
          pull, `${pull}#issuecomment-1`, issue, unknown, offline, unrelated, `[Original PR](${pull})`, `\`${issue}\``,
          "Shorthand: easyhaloo/agentforge#143 and cli/cli#7401.", "Unresolved: cli/cli#1, cli/cli#999999999.",
          "`cli/cli#7401`", ...extra,
        ].join("\n\n"));
        await preview.click();
        const markdown = page.locator(".issue-markdown");
        const verifyLinks = async () => {
          const shorthand = markdown.getByText(/^Shorthand:/);
          await expect(shorthand.getByRole("link", { name: "easyhaloo/agentforge#143", exact: true })).toHaveAttribute("href", pull);
          await expect(shorthand.getByRole("link", { name: "cli/cli#7401", exact: true })).toHaveAttribute("href", issue);
          await expect(markdown.getByText(/^Unresolved:/).getByRole("link")).toHaveCount(0);
          for (const [label, url] of [["easyhaloo/agentforge#143", pull], ["easyhaloo/agentforge#143 (comment)", `${pull}#issuecomment-1`], ["cli/cli#7401", issue], [unknown, unknown], [offline, offline], [unrelated, unrelated], ["Original PR", pull]]) {
            await expect(markdown.getByRole("link", { name: label, exact: true }).first()).toHaveAttribute("href", url);
          }
          await expect(markdown.locator("code")).toHaveText([issue, "cli/cli#7401"]);
        };
        const verifyCards = async () => {
          await page.setViewportSize({ width: 390, height: 844 });
          const card = markdown.getByRole("tooltip");
          const prLink = markdown.getByRole("link", { name: "easyhaloo/agentforge#143", exact: true }).first();
          await prLink.hover();
          await expect(card).toContainText("Apply account timezone");
          await expect(card).toContainText("Merged");
          const bounds = await card.boundingBox();
          expect(bounds?.x).toBeGreaterThanOrEqual(0);
          expect((bounds?.x ?? 390) + (bounds?.width ?? 0)).toBeLessThan(390);
          await card.hover();
          await expect(card).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(card).toBeHidden();

          const labeledPR = markdown.getByRole("link", { name: "Original PR", exact: true });
          await labeledPR.focus();
          await expect(card).toContainText("Apply account timezone");
          await page.keyboard.press("Escape");
          await expect(labeledPR).toBeFocused();
          await expect(card).toBeHidden();

          await markdown.getByRole("link", { name: "cli/cli#7401", exact: true }).last().focus();
          await expect(card).toContainText("Public issue title");
          await expect(card).toContainText("Closed");
          await markdown.getByRole("link", { name: unknown, exact: true }).focus();
          await expect(card).toBeHidden();
          await page.setViewportSize({ width: 1280, height: 720 });
        };
        await verifyLinks();
        await verifyCards();
        expect(lookups.sort()).toEqual(["cli/cli#1", "cli/cli#7401", "cli/cli#999999999", "easyhaloo/agentforge#143", ...extra.slice(0, 4)].sort());
        const published = apiResponse(issuesAPI, "POST");
        await create.click();
        const response = await published;
        expect(response.status()).toBe(201);
        const { number } = await response.json() as { number: number };
        await expect(page).toHaveURL(`${base.origin}${issuesPath}/${number}`);
        await page.reload();
        await verifyLinks();
        await verifyCards();
      } finally {
        await page.unroute(lookupURL);
      }
    });

    await test.step("REF-03–04: select a GitHub pull request without replacing local references or losing the draft", async () => {
      const search = `**${issuesAPI}/github-pull-search?*`;
      await page.route(search, async route => {
        const { searchParams } = new URL(route.request().url());
        const query = searchParams.get("q");
        const repo = searchParams.get("repository");
        if (query === "offline") return route.fulfill({ status: 503 });
        const items = query === "143" || query === "timezone"
          ? [{ number: 143, title: repo === "easyhaloo/agentforge" ? "Apply saved account timezone" : "Other repository PR" }]
          : [];
        await route.fulfill({ json: { items } });
      });
      try {
        await page.goto(`${base.origin}${createPath}`);
        await titleInput.fill("GitHub pull request selection");
        const suggestions = page.getByRole("listbox", { name: "Reference suggestions" });
        const expected = suggestions.getByRole("option", { name: "Pull request #143 Apply saved account timezone" });
        await descriptionInput.fill(`#${issue.number}`);
        await expect(suggestions.getByRole("option", { name: `#${issue.number} ${title} (edited)` })).toBeVisible();
        await descriptionInput.fill("easyhaloo/agentforge#143");
        await expect(expected).toBeVisible();
        await descriptionInput.press("Escape");
        await expect(suggestions).toBeHidden();
        await descriptionInput.fill("octocat/hello-world#143");
        await expect(suggestions.getByRole("option", { name: "Pull request #143 Other repository PR" })).toBeVisible();
        await expect(expected).toBeHidden();

        for (const query of ["8", "999999999", "offline"]) {
          const draft = `Draft: easyhaloo/agentforge#${query}`;
          await descriptionInput.fill(draft);
          const status = query === "offline" ? "Suggestions are temporarily unavailable." : "No suggestions found.";
          await expect(page.getByText(status, { exact: true })).toBeVisible();
          await expect(descriptionInput).toHaveValue(draft);
        }
        await descriptionInput.fill("See easyhaloo/agentforge#timezone");
        await expect(expected).toBeVisible();
        await descriptionInput.press("Enter");
        const pullURL = "https://github.com/easyhaloo/agentforge/pull/143";
        await expect(descriptionInput).toHaveValue(`See ${pullURL} `);
        await preview.click();
        const link = page.locator(".issue-markdown").locator(`a[href="${pullURL}"]`);
        await expect(link).toBeVisible();
        const published = apiResponse(issuesAPI, "POST");
        await create.click();
        const response = await published;
        expect(response.status()).toBe(201);
        const { number } = await response.json() as { number: number };
        await expect(page).toHaveURL(`${base.origin}${issuesPath}/${number}`);
        await page.reload();
        await expect(link).toBeVisible();
      } finally {
        await page.unroute(search);
      }
    });

    await test.step("ISSUE-23–25, ISSUE-28 and REF-01–02: complete Issue and Changeset references and emoji", async () => {
      await page.goto(`${base.origin}${createPath}`);
      await titleInput.fill("Verify Issue body completions");
      const issueSuggestions = page.getByRole("listbox", { name: "Reference suggestions" });
      const matchingIssue = issueSuggestions.getByRole("option", { name: `#${issue.number} ${title} (edited)` });
      const emojiSuggestions = page.getByRole("listbox", { name: "Emoji suggestions" });

      const reference = page.getByRole("button", { name: "Reference", exact: true });
      await descriptionInput.fill("Review");
      await write.focus();
      await write.press("Tab");
      await page.getByRole("toolbar", { name: "Markdown formatting" }).getByRole("button", { name: "Heading", exact: true }).press("End");
      await expect(reference).toBeFocused();
      await reference.press("Enter");
      await expect(descriptionInput).toBeFocused();
      await expect(descriptionInput).toHaveValue("Review #");
      await expect(issueSuggestions.getByRole("option").first()).toBeVisible();
      await descriptionInput.press("Escape");
      await descriptionInput.fill("Replace and preserve this ending");
      await descriptionInput.press("Home");
      for (let step = 0; step < "Replace".length; step++) await descriptionInput.press("Shift+ArrowRight");
      await reference.click();
      await expect(descriptionInput).toHaveValue("# and preserve this ending");
      await descriptionInput.press(String(issue.number));
      await matchingIssue.click();
      await expect(descriptionInput).toHaveValue(`#${issue.number} and preserve this ending`);

      await descriptionInput.fill("Review #");
      await expect(issueSuggestions.getByRole("option").nth(1)).toBeVisible();
      await descriptionInput.press("ArrowDown");
      await expect(issueSuggestions.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
      await descriptionInput.press("Escape");
      await expect(issueSuggestions).toBeHidden();
      await expect(descriptionInput).toHaveValue("Review #");
      await expect(descriptionInput).toBeFocused();

      await descriptionInput.press(String(issue.number));
      await expect(matchingIssue).toBeVisible();
      await descriptionInput.press("Enter");
      await expect(descriptionInput).toHaveValue(`Review #${issue.number} `);
      await expect(issueSuggestions).toBeHidden();

      await descriptionInput.fill("See #Preserve and continue.");
      for (let step = 0; step < " and continue.".length; step++) await descriptionInput.press("ArrowLeft");
      expect(await descriptionInput.evaluate((field: HTMLTextAreaElement) => field.selectionStart)).toBe("See #Preserve".length);
      await expect(matchingIssue).toBeVisible();
      await matchingIssue.click();
      await expect(descriptionInput).toHaveValue(`See #${issue.number} and continue.`);
      await expect(descriptionInput).toBeFocused();

      await descriptionInput.fill("Unknown #zz_no_real_issue_match");
      await expect(page.getByText("No suggestions found.")).toBeVisible();
      const failedLookup = (url: URL) => url.pathname === issuesAPI && url.searchParams.get("q") === "cannot_load";
      await page.route(failedLookup, (route) => route.fulfill({ status: 503, json: { title: "Unavailable" } }));
      try {
        await descriptionInput.fill("Keep this draft #cannot_load");
        await expect(page.getByText("Suggestions are temporarily unavailable.")).toBeVisible();
        await expect(descriptionInput).toHaveValue("Keep this draft #cannot_load");
        await descriptionInput.press("Enter");
        await expect(descriptionInput).toHaveValue("Keep this draft #cannot_load\n");
      } finally {
        await page.unroute(failedLookup);
      }

      const obsoleteLookup = (url: URL) => url.pathname === issuesAPI && url.searchParams.get("q") === "prev_lookup";
      let releaseObsolete!: () => void;
      const newerLookupDone = new Promise<void>((resolve) => { releaseObsolete = resolve; });
      let replySent!: () => void;
      const obsoleteReply = new Promise<void>((resolve) => { replySent = resolve; });
      let obsoleteStarted = false;
      await page.route(obsoleteLookup, async (route) => {
        obsoleteStarted = true;
        await newerLookupDone;
        try {
          await route.fulfill({ status: 503, json: { title: "Obsolete response" } });
        } finally {
          replySent();
        }
      });
      try {
        await descriptionInput.fill("Review #prev_lookup");
        await expect.poll(() => obsoleteStarted).toBe(true);
        await descriptionInput.fill(`Review #${issue.number}`);
        await expect(matchingIssue).toBeVisible();
        releaseObsolete();
        await obsoleteReply;
        await expect(matchingIssue).toBeVisible();
        await expect(page.getByText("Suggestions are temporarily unavailable.")).toBeHidden();
      } finally {
        releaseObsolete();
        await page.unroute(obsoleteLookup);
      }

      await descriptionInput.fill(`Review #${issue.number} :rocke`);
      await expect(emojiSuggestions.getByRole("option", { name: /:rocket:/ })).toBeVisible();
      await preview.click();
      await expect(emojiSuggestions).toBeHidden();
      await write.click();
      await expect(descriptionInput).toHaveValue(`Review #${issue.number} :rocke`);
      await descriptionInput.press("End");
      await descriptionInput.press("t");
      await descriptionInput.press("Tab");
      await expect(descriptionInput).toBeFocused();
      await expect(descriptionInput).toHaveValue(`Review #${issue.number} :rocket: `);
      const changesetLabel = `Changeset ${changeset.id.slice(0, 8)}`;
      const changesetLink = new URL(changeset.detailsURL).pathname;
      await descriptionInput.pressSequentially("#WebIDE");
      await issueSuggestions.getByRole("option", { name: `${changesetLabel} Update README through WebIDE`, exact: true }).click();
      await expect(descriptionInput).toHaveValue(`Review #${issue.number} :rocket: [${changesetLabel}](<${changesetLink}>) `);
      await descriptionInput.pressSequentially(":ship");
      const customEmoji = emojiSuggestions.getByRole("option", { name: ":shipit:", exact: true });
      await expect(customEmoji.locator("img")).toHaveAttribute("src", /github\.githubassets\.com.*shipit\.png/);
      await customEmoji.click();
      await descriptionInput.pressSequentially(":unknown_emoji: `:octocat:`");
      await preview.click();
      const verifyCompletions = async () => {
        const markdown = page.locator(".issue-markdown");
        await expect(markdown.getByRole("link", { name: `#${issue.number}`, exact: true })).toHaveAttribute("href", `${issuesPath}/${issue.number}`);
        await expect(markdown).toContainText("🚀");
        await expect(markdown.getByRole("img", { name: ":shipit:", exact: true })).toHaveAttribute("src", /github\.githubassets\.com.*shipit\.png/);
        await expect(markdown).toContainText(":unknown_emoji:");
        await expect(markdown.locator("code")).toHaveText(":octocat:");
        await expect(markdown.getByRole("link", { name: changesetLabel, exact: true })).toHaveAttribute("href", changesetLink);
      };
      await verifyCompletions();
      const publishing = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await publishing;
      expect(response.status()).toBe(201);
      const { number, body } = await response.json() as { number: number; body: string };
      expect(body.trim()).toBe(`Review #${issue.number} :rocket: [${changesetLabel}](<${changesetLink}>) :shipit: :unknown_emoji: \`:octocat:\``);
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/${number}`);
      await page.reload();
      await verifyCompletions();
      await page.locator(".issue-markdown").getByRole("link", { name: changesetLabel, exact: true }).click();
      await expect(page).toHaveURL(changeset.detailsURL);
    });

    await test.step("ISSUE-06: reject creation for a repository that was never registered", async () => {
      await page.unroute(`**${issuesAPI}`);
      await page.goto(`${base.origin}${organizationPath}/repositories/issues-qa/unregistered-${randomUUID()}/issues/new`);
      await titleInput.fill("Do not publish to an unregistered repository");
      const rejected = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await rejected;
      expect(response.status()).toBe(404);
      expect(await response.json()).toMatchObject({ title: "Repository not found" });
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(titleInput).toHaveValue("Do not publish to an unregistered repository");
    });
    const templateBody = "## Steps to reproduce\n\n**Use the template.**\n";
    await test.step("TEMPLATE-01 to TEMPLATE-06: choose, preview and publish a Git-backed Markdown template", async () => {
      const chooserPath = `${createPath}/choose`;
      const directory = join(gitDir, ".github/ISSUE_TEMPLATE");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "bug.md"), [
        "---", "name: Bug report", "about: Report a regression", 'title: "[Bug] "', 'labels: ["Ready for QA"]',
        'assignees: ["Issues QA"]', "---", "", templateBody,
      ].join("\n"));
      writeFileSync(join(directory, "report.yml"), [
        "name: Structured report", "description: Report an issue with a form", 'title: "[Report] "', "type: Bug", "body:",
        "  - type: markdown", "    attributes:", '      value: "**Before reporting**, check for duplicates."',
        "  - type: input", "    id: platform", "    attributes:", "      label: Platform", "      description: Include your operating system.", "      placeholder: macOS", "    validations:", "      required: true",
        "  - type: textarea", "    id: logs", "    attributes:", "      label: Debug logs", "      render: text", "      value: Default diagnostics",
        "  - type: dropdown", "    attributes:", "      label: Version", '      options: ["Stable", "Edge"]', "      default: 0", "    validations:", "      required: true",
        "  - type: dropdown", "    attributes:", "      label: Environments", '      options: ["Desktop", "Web"]', "      multiple: true", "    validations:", "      required: true",
        "  - type: checkboxes", "    attributes:", "      label: Confirmation", "      options:", "        - label: I searched existing issues", "          required: true",
        "  - type: upload", "    attributes:", "      label: Evidence file", "    validations:", '      accept: ".txt"', "      required: true", "",
      ].join("\n"));
      writeFileSync(join(directory, "invalid.md"), "---\nname: [\n---\nBroken");
      symlinkSync("bug.md", join(directory, "linked.md"));
      writeFileSync(join(directory, "config.yml"), [
        "blank_issues_enabled: false", "contact_links:", "  - name: Support", "    about: How to get help",
        "    url: https://example.test/support", "  - name: Invalid contact", "    about: Unsupported URL", "    url: mailto:help@example.test", "",
      ].join("\n"));
      for (const [path, filename, name] of [
        ["ISSUE_TEMPLATE", "root.md", "Root template"],
        ["ISSUE_TEMPLATE", "bug.md", "Shadow root bug"],
        ["docs/ISSUE_TEMPLATE", "docs.md", "Documentation template"],
        ["docs/ISSUE_TEMPLATE", "root.md", "Shadow docs root"],
      ]) {
        const location = join(gitDir, path);
        mkdirSync(location, { recursive: true });
        writeFileSync(join(location, filename), `---\nname: ${name}\nabout: Template location coverage\n---\n## ${name} content\n`);
      }
      git("add", ".github", "ISSUE_TEMPLATE", "docs/ISSUE_TEMPLATE");
      git("-c", "user.name=Issues QA", "-c", "user.email=issues@example.test", "commit", "--quiet", "-m", "Seed issue templates");
      git("switch", "--quiet", "-c", "qa-template-draft");
      writeFileSync(join(directory, "draft.md"), "---\nname: Unmerged draft\nabout: This template exists on another branch\n---\nDraft");
      git("add", ".github");
      git("-c", "user.name=Issues QA", "-c", "user.email=issues@example.test", "commit", "--quiet", "-m", "Seed non-default branch template");
      git("switch", "--quiet", "main");

      await page.goto(`${base.origin}${issuesPath}`);
      let templateReadUnavailable = true;
      await page.route(`**${repositoriesAPI}/${repository}/tree*`, (route) =>
        templateReadUnavailable ? route.fulfill({ status: 503 }) : route.continue());
      await newIssue.click();
      await expect(page).toHaveURL(`${base.origin}${chooserPath}`);
      await expect(page.getByRole("alert")).toHaveText("Could not load repository issue templates.");
      templateReadUnavailable = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Choose an issue template" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Bug report", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Structured report", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Unmerged draft", exact: true })).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveText("Some templates or chooser settings could not be loaded.");
      await expect(page.getByRole("link", { name: "Support" })).toHaveAttribute("href", "https://example.test/support");
      await expect(page.getByText("Invalid contact")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Blank issue", exact: true })).toBeVisible();
      await expect(page.getByText("Maintainers only")).toBeVisible();

      await page.goto(`${base.origin}${createPath}?template=linked.md`);
      await expect(page.getByRole("alert")).toContainText("missing or invalid");
      await page.getByRole("link", { name: "Choose an issue template" }).click();
      await page.getByRole("link", { name: "Bug report", exact: true }).click();
      await expect(page).toHaveURL(`${base.origin}${createPath}?template=bug.md`);
      await expect(titleInput).toHaveValue("[Bug] ");
      await expect(descriptionInput).toHaveValue(templateBody);
      await descriptionInput.fill("Do not discard this draft without confirmation.");
      const changeTemplate = page.getByRole("link", { name: "Change template", exact: true });
      await changeTemplate.click();
      const discard = page.getByRole("dialog");
      await discard.getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect(descriptionInput).toHaveValue("Do not discard this draft without confirmation.");
      await changeTemplate.click();
      await discard.getByRole("button", { name: /discard/i }).click();
      await expect(page).toHaveURL(`${base.origin}${chooserPath}`);

      const override = new URLSearchParams({ template: "bug.md", title: "Bug from template", body: `${templateBody}More details.` });
      await page.goto(`${base.origin}${createPath}?${override}`);
      await expect(titleInput).toHaveValue("Bug from template");
      await expect(descriptionInput).toHaveValue(`${templateBody}More details.`);
      await preview.click();
      const verifyTemplate = async () => {
        const markdown = page.locator(".issue-markdown");
        await expect(markdown.getByRole("heading", { name: "Steps to reproduce" })).toBeVisible();
        await expect(markdown.locator("strong")).toHaveText("Use the template.");
        await expect(markdown).toContainText("More details.");
      };
      await verifyTemplate();
      const publishing = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await publishing;
      expect(response.status()).toBe(201);
      const issue = await response.json();
      expect(issue).toMatchObject({ title: "Bug from template", body: `${templateBody}More details.`,
        labels: [{ name: "Ready for QA" }], assignees: [{ display_name: "Issues QA" }],
      });
      await expect(page).toHaveURL(`${base.origin}${issuesPath}/${issue.number}`);
      await page.reload();
      await verifyTemplate();
    });

    await test.step("TEMPLATE-12: read root and docs templates without shadowing earlier locations", async () => {
      for (const template of ["Root template", "Documentation template"]) {
        await page.goto(`${base.origin}${createPath}/choose`);
        await expect(page.getByRole("link", { name: "Bug report", exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: /^Shadow/ })).toHaveCount(0);
        await page.getByRole("link", { name: template, exact: true }).click();
        await preview.click();
        await expect(page.getByRole("heading", { name: `${template} content` })).toBeVisible();
      }
    });

    await test.step("TEMPLATE-10: insert a Git-backed Markdown template without replacing the draft", async () => {
      await page.goto(`${base.origin}${createPath}`);
      await titleInput.fill("Insert a template into this issue");
      await descriptionInput.fill("Before\n\n\nAfter");
      await descriptionInput.evaluate((textarea: HTMLTextAreaElement) => {
        const cursor = textarea.value.indexOf("\n\n") + 2;
        textarea.setSelectionRange(cursor, cursor);
      });
      await descriptionInput.pressSequentially("/template");
      await descriptionInput.press("Enter");
      const templates = page.getByRole("listbox", { name: "Templates", exact: true });
      await expect(templates.getByRole("option")).toHaveCount(3);
      await expect(templates.getByRole("option", { name: /Bug report/ })).toBeVisible();
      await descriptionInput.press("Enter");
      await expect(titleInput).toHaveValue("Insert a template into this issue");
      await expect(descriptionInput).toHaveValue(`Before\n\n${templateBody.trimEnd()}\n\n\nAfter`);
      await preview.click();
      const markdown = page.locator(".issue-markdown");
      await expect(markdown.getByRole("heading", { name: "Steps to reproduce" })).toBeVisible();
      await expect(markdown.locator("strong")).toHaveText("Use the template.");
      await expect(markdown.getByText("After", { exact: true })).toBeVisible();
    });

    await test.step("TEMPLATE-05: browser back between template query values protects the draft", async () => {
      const markdownTemplate = `${createPath}?template=bug.md`;
      const structuredTemplate = `${createPath}?template=report.yml`;
      // Seed consecutive entries for the same route to exercise a browser POP navigation.
      await page.route(`${base.origin}${markdownTemplate}`, async (route) => {
        const response = await route.fetch();
        const historySeed = `<script>history.replaceState({ idx: 0 }, '', ${JSON.stringify(structuredTemplate)});history.pushState({ idx: 1 }, '', ${JSON.stringify(markdownTemplate)});</script>`;
        await route.fulfill({ response, body: (await response.text()).replace("</head>", `${historySeed}</head>`) });
      }, { times: 1 });
      await page.goto(`${base.origin}${markdownTemplate}`);
      await expect(titleInput).toHaveValue("[Bug] ");
      await descriptionInput.fill("My template draft");
      await page.evaluate(() => history.back());
      const discard = page.getByRole("dialog");
      await discard.getByRole("button", { name: "Keep editing", exact: true }).click();
      await expect(descriptionInput).toHaveValue("My template draft");
      await expect(page).toHaveURL(`${base.origin}${markdownTemplate}`);
      await page.evaluate(() => history.back());
      await discard.getByRole("button", { name: /discard/i }).click();
      await expect(titleInput).toHaveValue("[Report] ");
      await expect(page).toHaveURL(`${base.origin}${structuredTemplate}`);
    });

    await test.step("TEMPLATE-07: validate, preview and publish a YAML Issue Form", async () => {
      await page.goto(`${base.origin}${issuesPath}`);
      await newIssue.click();
      await page.getByRole("link", { name: "Structured report", exact: true }).click();
      await expect(titleInput).toHaveValue("[Report] ");
      const formPath = `${createPath}?template=report.yml`;
      await test.step("TEMPLATE-13: carry URL field prefills through the template chooser", async () => {
        const params = new URLSearchParams({ platform: "macOS", logs: "trace\n```\nend" });
        await page.goto(`${base.origin}${createPath}/choose?${params}`);
        await page.getByRole("link", { name: "Structured report", exact: true }).click();
        const platform = page.getByRole("textbox", { name: "Platform" });
        const logs = page.getByRole("textbox", { name: "Debug logs" });
        await expect(platform).toHaveValue("macOS");
        await expect(logs).toHaveValue("trace\n```\nend");
        await preview.click();
        await expect(page.locator(".issue-composer__preview pre")).toContainText("trace\n```\nend");
        await page.getByRole("link", { name: "Change template", exact: true }).click();
        await expect(page).toHaveURL(`${base.origin}${createPath}/choose`);
        params.set("body", "One-time link prefill");
        await page.goto(`${base.origin}${createPath}/choose?${params}`);
        await page.getByRole("link", { name: "Structured report", exact: true }).click();
        await platform.fill("");
      });
      await titleInput.fill("[Report] QA reproduction");
      await expect(page.getByText("Before reporting", { exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Version" })).toHaveText(/Stable/);
      await preview.click();
      await create.click();
      await expect(page.getByRole("alert")).toContainText("Platform, Environments, Confirmation, Evidence file");
      const platform = page.getByRole("textbox", { name: "Platform" });
      await expect(platform).toBeFocused();
      await expect(platform).toHaveAttribute("aria-invalid", "true");
      await expect(platform).toHaveAccessibleDescription(/Include your operating system.*Complete the required fields/s);
      await platform.fill("    ");
      await expect(page.getByRole("alert")).toContainText("Platform");
      await platform.fill("macOS");
      await expect(platform).not.toHaveAttribute("aria-invalid", "true");
      const version = page.getByRole("combobox", { name: "Version" });
      await version.click();
      await page.getByRole("option", { name: "Select an option" }).click();
      await create.click();
      await expect(version).toBeFocused();
      await expect(version).toHaveAttribute("aria-invalid", "true");
      await version.click();
      await page.getByRole("option", { name: "Stable", exact: true }).click();
      await create.click();
      const environmentsGroup = page.getByRole("group", { name: "Environments" });
      await expect(environmentsGroup).toBeFocused();
      await expect(environmentsGroup).toHaveAttribute("aria-invalid", "true");
      await page.getByRole("textbox", { name: "Debug logs" }).fill("trace\n```\nend");
      await environmentsGroup.getByRole("button").click();
      const environments = page.getByRole("dialog", { name: "Environments" });
      await environments.getByRole("checkbox", { name: "Web" }).check();
      await environments.getByRole("checkbox", { name: "Desktop" }).check();
      await environments.getByRole("checkbox", { name: "Desktop" }).press("Escape");
      await page.getByRole("checkbox", { name: "I searched existing issues" }).check();
      const evidence = page.getByLabel("Evidence file", { exact: false });
      await expect(evidence).toHaveAttribute("aria-invalid", "true");
      await evidence.setInputFiles({ name: "reject.png", mimeType: "image/png", buffer: Buffer.from("rejected") });
      await expect(page.getByRole("alert").filter({ hasText: "reject.png" })).toBeVisible();
      await evidence.setInputFiles({ name: "trace.txt", mimeType: "text/plain", buffer: Buffer.from("evidence for the issue form") });
      await expect(page.getByRole("link", { name: "trace.txt" })).toBeVisible();
      await page.getByRole("button", { name: "Remove file" }).click();
      await expect(page.getByRole("alert")).toContainText("Evidence file");
      await evidence.setInputFiles({ name: "final.txt", mimeType: "text/plain", buffer: Buffer.from("final evidence") });
      await preview.click();
      const verifyForm = async (tab: Page) => {
        const markdown = tab.locator(".issue-composer__preview > .issue-markdown, .issue-detail__body > .issue-markdown");
        await expect(markdown.getByRole("heading", { name: "Platform" })).toBeVisible();
        await expect(markdown).toContainText("macOS");
        await expect(markdown.locator("pre")).toContainText("trace\n```\nend");
        await expect(markdown).toContainText("Stable");
        await expect(markdown).toContainText("Desktop, Web");
        await expect(markdown.getByRole("checkbox")).toBeChecked();
        await expect(markdown.getByRole("link", { name: "final.txt" })).toBeVisible();
        await expect(markdown).not.toContainText("Before reporting");
      };
      await verifyForm(page);
      const createMore = page.getByRole("checkbox", { name: "Create more" });
      await createMore.check();
      const publishing = apiResponse(issuesAPI, "POST");
      await create.click();
      const response = await publishing;
      expect(response.status()).toBe(201);
      const issue = await response.json();
      expect(issue).toMatchObject({ title: "[Report] QA reproduction", issue_type: "bug" });
      expect(issue.body).toContain("### Platform\n\nmacOS");
      expect(issue.body).toContain("One-time link prefill");
      const publishedTab = await context.newPage();
      try {
        await publishedTab.goto(`${base.origin}${issuesPath}/${issue.number}`);
        await publishedTab.reload();
        await verifyForm(publishedTab);
      } finally {
        await publishedTab.close();
      }

      await test.step("TEMPLATE-08: create another issue from a clean copy of the same template", async () => {
        await expect(page).toHaveURL(`${base.origin}${formPath}`);
        await expect(createMore).toBeChecked();
        await expect(titleInput).toBeFocused();
        await expect(titleInput).toHaveValue("[Report] ");
        await expect(platform).toHaveValue("");
        const logs = page.getByRole("textbox", { name: "Debug logs" });
        await expect(logs).toHaveValue("Default diagnostics");
        await expect(version).toHaveText(/Stable/);
        await expect(environmentsGroup.getByRole("button")).toHaveText("Select an option");
        await expect(page.getByRole("checkbox", { name: "I searched existing issues" })).not.toBeChecked();
        await expect(page.getByRole("link", { name: "final.txt" })).toHaveCount(0);
        const changeTemplate = page.getByRole("link", { name: "Change template", exact: true });
        await logs.fill("");
        await changeTemplate.click();
        await page.getByRole("dialog").getByRole("button", { name: "Keep editing", exact: true }).click();
        await expect(logs).toHaveValue("");
        await platform.fill("Linux");
        await titleInput.fill("[Report] Second reproduction");
        await environmentsGroup.getByRole("button").click();
        await environments.getByRole("checkbox", { name: "Web" }).check();
        await environments.getByRole("checkbox", { name: "Web" }).press("Escape");
        await page.getByRole("checkbox", { name: "I searched existing issues" }).check();
        await evidence.setInputFiles({ name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second evidence") });
        await expect(page.getByRole("link", { name: "second.txt" })).toBeVisible();
        const publishingAgain = apiResponse(issuesAPI, "POST");
        await create.click();
        const secondResponse = await publishingAgain;
        expect(secondResponse.status()).toBe(201);
        const secondIssue = await secondResponse.json();
        expect(secondIssue).toMatchObject({ title: "[Report] Second reproduction", issue_type: "bug" });
        expect(secondIssue.number).not.toBe(issue.number);
        expect(secondIssue.body).toContain("### Platform\n\nLinux");
        expect(secondIssue.body).toContain("second.txt");
        expect(secondIssue.body).not.toMatch(/macOS|One-time link prefill|final\.txt/);
        await expect(titleInput).toHaveValue("[Report] ");
        await changeTemplate.click();
        await expect(page).toHaveURL(`${base.origin}${createPath}/choose`);
      });
    });

    await test.step("TEMPLATE-11: return to a prefilled issue after real sign-in", async () => {
      await page.locator(".user-menu-trigger").click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(`${base.origin}/login`);

      const query = new URLSearchParams({ template: "bug.md", title: "Preserve prefills after sign-in", body: "## Restore this draft" });
      const target = `${createPath}?${query}`;
      await page.goto(`${base.origin}${target}`);
      await expect(page.getByRole("heading", { name: "Sign in to AgentForge" })).toBeVisible();
      expect(new URL(page.url()).searchParams.get("return")).toBe(target);
      await expect(create).toHaveCount(0);

      await page.locator('[name=email]').fill(email);
      await page.locator('[name=password]').fill(password);
      await page.locator('button[type=submit]').click();
      await expect(page).toHaveURL(`${base.origin}${target}`);
      await expect(titleInput).toHaveValue("Preserve prefills after sign-in");
      await expect(descriptionInput).toHaveValue("## Restore this draft");
      await expect(page.getByRole("link", { name: "Change template" })).toBeVisible();
      await preview.click();
      await expect(page.locator(".issue-markdown").getByRole("heading", { name: "Restore this draft" })).toBeVisible();
    });
  } finally {
    rmSync(gitDir, { recursive: true, force: true });
  }
});

test("ISSUE-29: only compact cross-organization links the viewer can read", async ({ page, browser }) => {
  const psql = process.env.AGENTFORGE_TEST_PSQL;
  test.skip(!psql, "Requires the local PostgreSQL membership fixture");
  const target = await browser.newPage();
  try {
    async function createRepository(tab: Page, name: string) {
      const password = randomUUID();
      await tab.goto(`${origin}/register`);
      await tab.locator('[name=email]').fill(`${randomUUID()}@example.test`);
      await tab.locator('[name=displayName]').fill("Issue reference QA");
      await tab.locator('[name=password]').fill(password);
      await tab.locator('[name=confirmPassword]').fill(password);
      await tab.locator('button[type=submit]').click();
      await expect(tab).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
      const org = new URL(tab.url()).pathname.split("/")[2];
      await tab.goto(`${origin}/orgs/${org}/repositories/new`);
      await tab.getByLabel("Repository name", { exact: true }).fill(name);
      await tab.getByRole("button", { name: "Create repository", exact: true }).click();
      await expect(tab).toHaveURL(new RegExp(`/repositories/[^/]+/${name}$`));
      return { org, url: tab.url(), slug: new URL(tab.url()).pathname.split("/repositories/")[1] };
    }
    const [source, destination] = await Promise.all([createRepository(page, "source"), createRepository(target, "target")]);
    const title = (tab: Page) => tab.getByRole("textbox", { name: "Title", exact: true });
    const create = (tab: Page) => tab.getByRole("button", { name: /^Create issue\b/i });
    await target.goto(`${destination.url}/issues/new`);
    await title(target).fill("Private target");
    await create(target).click();
    await expect(target).toHaveURL(/\/issues\/1$/);
    const link = `${target.url()}?view=all#details`;
    const missing = `${destination.url}/issues/987654321`;
    const path = `${source.url}/issues/new`;
    const markdown = page.locator(".issue-markdown");
    async function preview() {
      await title(page).fill("Cross-organization references");
      await page.getByRole("textbox", { name: "Description", exact: true }).fill(`${link}\n\n${missing}`);
      await page.getByRole("tab", { name: "Preview", exact: true }).click();
    }
    await page.goto(path);
    await preview();
    await expect(markdown.getByRole("link", { name: link, exact: true })).toHaveAttribute("href", link);
    const user = await page.evaluate(async () => (await (await fetch("/api/v1/me")).json() as { user_id: string }).user_id);
    expect(user).toMatch(/^[a-f0-9]{32}$/);
    expect(destination.org).toMatch(/^[a-f0-9]{32}$/);
    execFileSync(psql!, ["-X", "-v", "ON_ERROR_STOP=1"], {
      input: `INSERT INTO organization_memberships (organization_id, user_id, role, status)
        VALUES ('${destination.org}', '${user}', 'viewer', 'active');`,
    });
    await page.reload();
    await preview();
    const verifyLinks = async () => {
      await expect(markdown.getByRole("link", { name: `${destination.slug}#1`, exact: true })).toHaveAttribute("href", new URL(link).pathname + "?view=all#details");
      await expect(markdown.getByRole("link", { name: missing, exact: true })).toHaveAttribute("href", missing);
    };
    await verifyLinks();
    await create(page).click();
    await expect(page).toHaveURL(`${source.url}/issues/1`);
    await page.reload();
    await verifyLinks();
  } finally {
    await target.close();
  }
});
