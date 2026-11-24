import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import { selectOption } from "./support/select-option";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
const gitRoot = process.env.GIT_REPOSITORY_ROOT ?? join(process.env.RUN_DIR ?? "/tmp/agentforge-dev", "git");
test.skip(!origin, "Requires the local API, PostgreSQL, and dev stack Git root");

test("reviews an updated pull request and merges only its verified revision", async ({ page }, testInfo) => {
  test.slow();
  const base = new URL(origin!);
  const capture = async (name: string, fullPage = true) => {
    const path = testInfo.outputPath(`pull-request-${name}.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path, animations: "disabled", fullPage, style: ".af-notification-viewport { visibility: hidden; }" });
    await testInfo.attach(`Pull request ${name}`, { path, contentType: "image/png" });
  };
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(base.hostname);
  const register = async (browserPage: typeof page, displayName: string) => {
    await browserPage.goto(`${base.origin}/register`);
    const password = randomUUID();
    await browserPage.locator('[name=email]').fill(`pulls-${randomUUID()}@example.test`);
    await browserPage.locator('[name=displayName]').fill(displayName);
    await browserPage.locator('[name=password]').fill(password);
    await browserPage.locator('[name=confirmPassword]').fill(password);
    await browserPage.locator('button[type=submit]').click();
    await expect(browserPage).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
    return browserPage.evaluate(async () => {
      const response = await fetch("/api/v1/me", { credentials: "include" });
      if (!response.ok) throw new Error(`Account lookup failed (${response.status})`);
      return await response.json() as { user_id: string; organizations: Array<{ id: string }> };
    });
  };
  const reviewerContext = await page.context().browser()!.newContext({ locale: "en-US" });
  const reviewer = await reviewerContext.newPage();
  const [account, reviewerAccount] = await Promise.all([register(page, "Pull Request QA"), register(reviewer, "Pull Request Reviewer")]);
  const orgPath = new URL(page.url()).pathname.replace(/\/changesets$/, "");
  const orgID = account.organizations[0].id;
  expect(orgID).toMatch(/^[a-zA-Z0-9_-]+$/);
  expect(reviewerAccount.user_id).toMatch(/^[a-zA-Z0-9_-]+$/);
  // Local authentication does not support the OIDC invitation flow. Seed only the membership.
  const psql = process.env.AGENTFORGE_TEST_PSQL;
  const psqlArgs = psql ? ["-X"] : ["compose", "exec", "-T", "postgres", "psql",
    "-U", process.env.DB_USER ?? "agentforge", "-d", process.env.DB_NAME ?? "agentforge"];
  execFileSync(psql || "docker", [...psqlArgs, "-v", "ON_ERROR_STOP=1",
    "-v", `org=${orgID}`, "-v", `reviewer=${reviewerAccount.user_id}`], {
    input: "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (:'org', :'reviewer', 'member');\n",
  });

  const ownerDir = join(gitRoot, orgID, "pulls-qa");
  mkdirSync(ownerDir, { recursive: true });
  const repositoryDir = mkdtempSync(join(ownerDir, "repo-"));
  const repository = `pulls-qa/${basename(repositoryDir)}`;
  const checkout = mkdtempSync(join(tmpdir(), "af-pull-checkout-"));
  const otherRepositoryDir = mkdtempSync(join(ownerDir, "repo-"));
  const otherRepository = `pulls-qa/${basename(otherRepositoryDir)}`;
  const gitAt = (directory: string, ...args: string[]) => execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
  const git = (...args: string[]) => gitAt(repositoryDir, ...args);
  const commit = (contents: string, subject: string) => {
    writeFileSync(join(checkout, "README.md"), contents);
    gitAt(checkout, "add", "README.md");
    gitAt(checkout, "-c", "user.name=Pull Request QA", "-c", "user.email=pulls@example.test", "commit", "--quiet", "-m", subject);
    return gitAt(checkout, "rev-parse", "HEAD");
  };

  try {
    gitAt(checkout, "init", "--quiet", "--initial-branch=main", "--template=");
    const target = commit("# Documentation\n", "Seed repository");
    gitAt(checkout, "branch", "release");
    gitAt(checkout, "switch", "--quiet", "-c", "feature/docs");
    const firstHead = commit("# Documentation\n\nFirst revision.\n", "Add revision notes");
    gitAt(checkout, "switch", "--quiet", "main");
    gitAt(checkout, "clone", "--quiet", "--bare", "--template=", checkout, repositoryDir);

    gitAt(otherRepositoryDir, "init", "--quiet", "--initial-branch=main", "--template=");
    gitAt(otherRepositoryDir, "-c", "user.name=Pull Request QA", "-c", "user.email=pulls@example.test",
      "commit", "--quiet", "--allow-empty", "-m", "Seed second repository");
    for (const directory of [otherRepositoryDir, repositoryDir]) {
      await page.goto(`${base.origin}${orgPath}/repositories/new`);
      await page.getByRole("link", { name: "Register an existing repository" }).click();
      await page.getByLabel("Owner", { exact: true }).fill("pulls-qa");
      await page.getByLabel("Repository name", { exact: true }).fill(basename(directory));
      await page.getByRole("button", { name: "Register repository", exact: true }).click();
      await expect(page).toHaveURL(`${base.origin}${orgPath}/repositories/pulls-qa/${basename(directory)}`);
    }
    const banner = page.getByRole("banner");
    const repoNav = page.getByRole("navigation", { name: "Repository sections" });
    const currentSection = repoNav.locator('[aria-current="page"]');
    const repositoryPath = `${orgPath}/repositories/${repository}`;
    await expect(banner.locator(".topbar-repository").getByRole("link", { name: basename(repositoryDir), exact: true })).toHaveAttribute("href", repositoryPath);
    await expect(currentSection).toHaveText("Code");
    await expect(page.getByRole("main").getByRole("heading", { name: repository, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open WebIDE" })).toBeVisible();
    await expect(page.getByRole("link", { name: "README.md", exact: true })).toBeVisible();
    await capture("repository-code", false);
    const bannerBox = (await banner.boundingBox())!;
    expect((await repoNav.boundingBox())!.y).toBe(bannerBox.y + bannerBox.height);
    await repoNav.getByRole("link", { name: "Issues", exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${repositoryPath}/issues`);
    await expect(currentSection).toHaveText("Issues");
    await expect(page.getByRole("main").getByRole("heading", { name: repository, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New issue" })).toBeVisible();
    await capture("repository-issues", false);
    await repoNav.getByRole("link", { name: "Pull requests", exact: true }).click();
    const pullsPath = `${repositoryPath}/pulls`;
    await expect(page).toHaveURL(`${base.origin}${pullsPath}`);
    await page.getByRole("link", { name: "New pull request" }).click();
    await expect(page).toHaveURL(`${base.origin}${pullsPath}/new`);
    const repositoryUrl = `${base.origin}${repositoryPath}`;
    await page.goto(`${repositoryUrl}/issues/new`);
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Verify Development entry point");
    await page.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(page).toHaveURL(`${repositoryUrl}/issues/1`);
    await test.step("DETAIL-14: no branch can be created before a base ref exists", async () => {
      const refs = ["main", "release", "feature/docs"];
      const heads = refs.map((name) => git("rev-parse", name));
      await expect(page.getByRole("button", { name: "Create a branch", exact: true })).toBeVisible();
      refs.forEach((name) => git("update-ref", "-d", `refs/heads/${name}`));
      try {
        await page.reload();
        await page.getByRole("button", { name: "Create a branch", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Create a branch" });
        await expect(dialog.getByText("Make the first Git commit before creating a branch.")).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Create a branch", exact: true })).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      } finally {
        refs.forEach((name, index) => git("update-ref", `refs/heads/${name}`, heads[index]));
        await page.reload();
      }
    });
    await test.step("DETAIL-14: pin, create and reopen a real issue branch", async () => {
      const create = () => page.getByRole("button", { name: "Create a branch", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Create a branch" });
      const suffix = dialog.getByRole("textbox", { name: "Branch name suffix" });
      const confirm = dialog.getByRole("button", { name: "Create a branch", exact: true });
      const branch = dialog.getByRole("combobox", { name: "Base branch", exact: true });
      await create();
      await suffix.fill("bad/name");
      await expect(confirm).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(git("branch", "--list", "agentforge/issues/*")).toBe("");
      await create();
      await suffix.fill("verified-branch");
      await selectOption(page, branch, "release");
      try {
        git("branch", "-f", "release", firstHead);
        await confirm.click();
        await expect(dialog.getByRole("alert")).toContainText("the base branch changed");
        await expect(suffix).toHaveValue("verified-branch");
        expect(git("branch", "--list", "agentforge/issues/*")).toBe("");
        await dialog.getByRole("button", { name: "Retry" }).click();
        await expect(confirm).toBeEnabled();
        await confirm.click();
        const createdBranch = page.getByRole("link", { name: "verified-branch", exact: true });
        await expect(createdBranch).toBeVisible();
        const href = await createdBranch.getAttribute("href");
        const ref = new URL(href!, base.origin).searchParams.get("ref");
        expect(ref).toMatch(/^refs\/heads\/agentforge\/issues\/[a-f0-9]+\/verified-branch$/);
        expect(git("rev-parse", ref!)).toBe(firstHead);
        await page.reload();
        await expect(createdBranch).toHaveAttribute("href", href!);
        await create();
        await suffix.fill("verified-branch");
        await confirm.click();
        await expect(dialog.getByRole("alert")).toContainText("The branch name already exists");
        expect(git("rev-parse", ref!)).toBe(firstHead);
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await createdBranch.click();
        await expect(page.getByText("Add revision notes", { exact: true })).toBeVisible();
        await reviewer.goto(new URL(href!, base.origin).href);
        await expect(reviewer.getByText("Add revision notes", { exact: true })).toBeVisible();
        await page.goto(`${repositoryUrl}/issues/1`);
      } finally {
        git("branch", "-f", "release", target);
      }
    });
    const keywordIssue = await page.context().newPage();
    try {
      await keywordIssue.goto(`${repositoryUrl}/issues/new`);
      await keywordIssue.getByRole("textbox", { name: "Title", exact: true }).fill("Verify closure from a pull request description");
      await keywordIssue.getByRole("button", { name: "Create issue", exact: true }).click();
      await expect(keywordIssue).toHaveURL(`${repositoryUrl}/issues/2`);
    } finally {
      await keywordIssue.close();
    }
    await page.getByRole("link", { name: "Create pull request", exact: true }).click();
    await expect(page).toHaveURL(`${base.origin}${pullsPath}/new?issue=1`);
    await expect(page.getByRole("link", { name: "Link to issue #1" })).toHaveAttribute("href", `${orgPath}/repositories/${repository}/issues/1`);
    await selectOption(page, page.getByRole("combobox", { name: "Base branch", exact: true }), "release");
    await selectOption(page, page.getByRole("combobox", { name: "Compare branch", exact: true }), "feature/docs");
    await expect(page.getByText("Add revision notes", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/First revision\./).first()).toBeVisible();
    await capture("compare");
    const title = "Document the verification workflow";
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Description", { exact: true }).fill("A real pull request from the Git test repository. Fixes: #2.");
    await page.getByRole("checkbox", { name: "Create as draft" }).check();
    const created = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/changesets"));
    await page.getByRole("button", { name: "Create draft pull request" }).click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const { changeset } = await createdResponse.json() as { changeset: { id: string; title: string; revisions: { id: string; commit_sha: string }[] } };
    expect(changeset.title).toBe(title);
    expect(changeset.revisions[0].commit_sha).toBe(firstHead);
    const detail = `${base.origin}${pullsPath}/${changeset.id}`;
    await expect(page).toHaveURL(detail);
    await expect(currentSection).toHaveText("Pull requests");
    await expect(page.getByRole("main").getByRole("heading", { name: repository, exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
    await capture("repository-pr-desktop", false);
    const pullDevelopment = page.getByRole("region", { name: "Development", exact: true });
    await expect(pullDevelopment.getByRole("link", { name: /^#1 / })).toHaveAttribute("href", `${repositoryPath}/issues/1`);
    await pullDevelopment.getByRole("button", { name: "Link an issue", exact: true }).click();
    const linkDialog = page.getByRole("dialog", { name: "Link an issue" });
    await linkDialog.getByRole("textbox", { name: "Issue number" }).fill("2");
    await linkDialog.getByRole("button", { name: "Link issue", exact: true }).click();
    await expect(pullDevelopment.getByRole("link", { name: /^#2 / })).toBeVisible();
    await page.reload();
    await expect(pullDevelopment.getByRole("link", { name: /^#2 / })).toBeVisible();
    await pullDevelopment.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("pull-request-development-linked-issues.png"), animations: "disabled" });
    await pullDevelopment.getByRole("button", { name: "Unlink issue #2", exact: true }).click();
    await expect(pullDevelopment.getByRole("link", { name: /^#2 / })).toHaveCount(0);
    await expect(pullDevelopment.getByRole("link", { name: /^#1 / })).toBeVisible();
    await reviewer.goto(`${repositoryUrl}/issues/1`);
    const development = reviewer.locator("aside");
    await expect(development.getByRole("link", { name: title, exact: true })).toBeVisible();
    await expect(reviewer.getByRole("region", { name: "Issue timeline" }).getByRole("link", { name: title, exact: true })).toBeVisible();
    await reviewer.goto(`${repositoryUrl}/issues/2`);
    await expect(reviewer.getByRole("heading", { name: "Verify closure from a pull request description" })).toBeVisible();
    await expect(development.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    await test.step("REF-05: select, preview and publish a local pull request reference", async () => {
      await reviewer.goto(`${repositoryUrl}/issues/new`);
      await reviewer.getByRole("textbox", { name: /Title/ }).fill("Reference the verification pull request");
      const description = reviewer.getByRole("textbox", { name: "Description", exact: true });
      await description.fill("See #verification");
      const label = `Pull request ${changeset.id.slice(0, 8)}`;
      await reviewer.getByRole("listbox", { name: "Reference suggestions" })
        .getByRole("option", { name: `${label} ${title}`, exact: true }).click({ timeout: 5_000 });
      await reviewer.getByRole("tab", { name: "Preview" }).click();
      await expect(reviewer.getByRole("link", { name: label })).toHaveAttribute("href", new URL(detail).pathname);
      const published = reviewer.waitForResponse(response => response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith("/issues"));
      await reviewer.getByRole("button", { name: "Create issue", exact: true }).click();
      expect((await published).status()).toBe(201);
      await expect(reviewer).toHaveURL(new RegExp(`${repositoryUrl}/issues/\\d+$`));
      const issue = await page.context().newPage();
      try {
        await issue.goto(reviewer.url());
        await issue.getByRole("link", { name: label }).click();
        await expect(issue).toHaveURL(detail);
        await expect(issue.getByRole("heading", { name: title, exact: true })).toBeVisible();
      } finally {
        await issue.close();
      }
    });
    const editTitle = page.getByRole("button", { name: "Edit title" });
    const titleInput = page.getByRole("textbox", { name: "Title", exact: true });
    const cancelTitle = page.getByRole("button", { name: "Cancel", exact: true });
    const saveTitle = page.getByRole("button", { name: "Save", exact: true });
    await editTitle.click();
    await expect(titleInput).toBeFocused();
    await expect(titleInput).toHaveValue(title);
    await titleInput.fill("   ");
    await expect(saveTitle).toBeDisabled();
    await titleInput.fill("x".repeat(201));
    await expect(saveTitle).toBeDisabled();
    await expect(page.getByText("Use 200 characters or fewer.")).toBeVisible();
    await titleInput.fill("Discard this title");
    await cancelTitle.click();
    await expect(editTitle).toBeFocused();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await editTitle.click();
    await titleInput.fill("Discard this too");
    await titleInput.press("Escape");
    await expect(editTitle).toBeFocused();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("feature/docs", { exact: true }).first()).toBeVisible();
    const conversationTab = page.getByRole("tab", { name: /Conversation/ });
    const commitsTab = page.getByRole("tab", { name: /Commits/ });
    const checksTab = page.getByRole("tab", { name: /Checks/ });
    const filesTab = page.getByRole("tab", { name: /Files changed/ });
    await expect(conversationTab).toHaveAccessibleName("Conversation 0");
    await expect(commitsTab).toHaveAccessibleName("Commits 1");
    await expect(checksTab).toHaveAccessibleName("Checks 0");
    await expect(filesTab).toHaveAccessibleName("Files changed 1");
    await expect(conversationTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAccessibleName("Conversation 0");
    await expect(conversationTab).toHaveCSS("font-size", "14px");
    await expect(conversationTab.locator("svg")).toHaveCSS("width", "18px");
    const expectSelectedOutline = async (selected: typeof conversationTab, inactive: typeof conversationTab) => {
      const baseline = await inactive.evaluate(tab => getComputedStyle(tab).borderBottomColor);
      expect(baseline).not.toBe("rgba(0, 0, 0, 0)");
      await expect(inactive).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
      await expect(selected).toHaveCSS("border-top", `1px solid ${baseline}`);
      await expect(selected).toHaveCSS("border-left-color", baseline);
      await expect(selected).toHaveCSS("border-right-color", baseline);
      await expect(selected).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
      await expect(selected.locator(".pull-tab-count")).toHaveCSS("border-radius", "999px");
    };
    await expectSelectedOutline(conversationTab, commitsTab);
    const post = (path: string, body: object) => page.evaluate(async ({ path, body }) => {
      const token = document.cookie.split("; ").find(entry => entry.startsWith("__Host-agentforge_csrf="))?.split("=")[1] ?? "";
      const response = await fetch(path, {
        method: "POST", credentials: "include", body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(token) },
      });
      return { status: response.status, detail: (await response.json() as { detail?: string }).detail };
    }, { path: `/api/v1/organizations/${orgID}/changesets/${changeset.id}/${path}`, body });
    const merge = page.getByRole("button", { name: "Merge pull request", exact: true });
    await expect(merge.filter({ visible: true }).and(page.locator(":enabled"))).toHaveCount(0);
    expect(await post("merge", { target_ref: "release" })).toEqual({ status: 422, detail: "draft pull request cannot be approved or merged" });
    const stateBadge = (name: string) => page.getByRole("button", { name, exact: true });
    const statusMenu = page.getByRole("dialog", { name: "Pull request status" });
    const menuAction = (name: string) => statusMenu.getByRole("button", { name, exact: true });
    const openBadge = stateBadge("Open");
    const draftBadge = stateBadge("Draft");
    await draftBadge.click();
    await expect(menuAction("Close pull request")).toBeVisible();
    await menuAction("Ready for review").click();
    await expect(openBadge).toBeFocused();
    await openBadge.press("Enter");
    await expect(openBadge).toHaveAttribute("aria-expanded", "true");
    await expect(statusMenu.getByRole("button")).toHaveText(["Convert to draft", "Close pull request"]);
    await expect(menuAction("Convert to draft")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(menuAction("Close pull request")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(statusMenu).toBeHidden();
    await expect(openBadge).toBeFocused();
    await openBadge.click();
    const badgeBounds = (await openBadge.boundingBox())!;
    const panelBounds = (await statusMenu.boundingBox())!;
    expect(panelBounds.x).toBeCloseTo(badgeBounds.x, 0);
    expect(panelBounds.y).toBeGreaterThan(badgeBounds.y + badgeBounds.height);
    await menuAction("Close pull request").hover();
    await capture("status-menu-open", false);
    await page.route("**/pull-request/state", route => route.abort("failed"), { times: 1 });
    await menuAction("Convert to draft").click();
    await expect(page.locator(".pull-request-header").getByRole("alert")).toHaveText("Failed to change pull request state");
    await expect(openBadge).toBeFocused();
    await openBadge.click();
    await menuAction("Convert to draft").click();
    await expect(page.locator(".pull-request-header").getByRole("alert")).toHaveCount(0);
    await expect(draftBadge).toBeFocused();
    await page.reload();
    await draftBadge.click();
    await menuAction("Ready for review").click();
    await expect(openBadge).toBeFocused();

    const desktopViewport = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    await openBadge.click();
    const mobilePanel = (await statusMenu.boundingBox())!;
    expect(mobilePanel.x).toBeGreaterThanOrEqual(0);
    expect(mobilePanel.x + mobilePanel.width).toBeLessThanOrEqual(390);
    await capture("status-menu-mobile", false);
    await page.getByRole("heading", { name: title, exact: true }).click();
    await expect(statusMenu).toBeHidden();
    await page.setViewportSize(desktopViewport);

    await page.getByPlaceholder("Leave a comment").fill("Verified the proposal locally.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText("Verified the proposal locally.", { exact: true })).toBeVisible();
    await expect(conversationTab).toHaveAccessibleName("Conversation 1");
    await capture("conversation");
    await conversationTab.focus();
    await conversationTab.press("ArrowRight");
    await expect(page).toHaveURL(`${detail}/commits`);
    await expect(commitsTab).toBeFocused();
    await expect(commitsTab).toHaveCSS("outline-style", "solid");
    await expect(commitsTab).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(conversationTab).toHaveAttribute("aria-selected", "true");
    await page.goForward();
    await expect(commitsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAccessibleName("Commits 1");
    await expectSelectedOutline(commitsTab, conversationTab);
    await expect(page.getByRole("button", { name: "Close pull request" })).toHaveCount(0);
    await expect(page.getByText("Add revision notes", { exact: true })).toBeVisible();
    await commitsTab.blur();
    await capture("commits");
    await filesTab.click();
    await expect(page).toHaveURL(`${detail}/files`);
    await expect(page.getByText(/First revision\./).first()).toBeVisible();
    await page.getByRole("button", { name: /Add a comment to this line/i }).last().click();
    await page.getByPlaceholder("Leave a comment").fill("Consider documenting the second revision too.");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText("Consider documenting the second revision too.", { exact: true })).toBeVisible();
    await expect(conversationTab).toHaveAccessibleName("Conversation 2");
    await capture("files");

    await conversationTab.click();
    const close = page.getByRole("button", { name: "Close pull request" });
    const reopen = page.getByRole("button", { name: "Reopen pull request" });
    const composer = page.getByRole("form", { name: "Write a comment" });
    const commentInput = composer.getByRole("textbox", { name: "Write a comment" });
    const commentButton = composer.getByRole("button", { name: "Comment", exact: true });
    await expect(composer.getByRole("button", { name: "Close pull request" })).toBeVisible();
    await expect(close).toHaveAttribute("type", "button");
    const closeBox = (await close.boundingBox())!;
    const commentBox = (await commentButton.boundingBox())!;
    const editorBox = (await composer.locator(".pull-comment-editor").boundingBox())!;
    expect(closeBox.y).toBeGreaterThan(editorBox.y + editorBox.height);
    expect(closeBox.y).toBe(commentBox.y);
    expect(closeBox.x + closeBox.width).toBeLessThan(commentBox.x);
    await expect(commentButton).toBeDisabled();
    await capture("close");
    await reviewer.goto(detail);
    await expect(reviewer.getByRole("button", { name: "Comment", exact: true })).toBeVisible();
    await expect(reviewer.getByRole("button", { name: "Edit title" })).toHaveCount(0);
    await expect(reviewer.locator(".pull-request-meta .pull-state")).toHaveText("Open");
    await expect(reviewer.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
    await expect(reviewer.getByRole("button", { name: /^(Close|Reopen) pull request$/ })).toHaveCount(0);
    await commentInput.fill("An unsent draft");
    await openBadge.click();
    await menuAction("Close pull request").click();
    await expect(stateBadge("Closed")).toBeFocused();
    await expect(composer.getByRole("button", { name: "Reopen pull request" })).toBeVisible();
    await expect(commentInput).toHaveValue("An unsent draft");
    await expect(conversationTab).toHaveAccessibleName("Conversation 2");
    expect(await post("merge", { target_ref: "release" })).toEqual({ status: 422, detail: "closed pull request cannot be approved or merged" });
    await page.reload();
    await expect(reopen).toBeVisible();
    await expect(page.getByText("Verified the proposal locally.", { exact: true })).toBeVisible();
    await capture("reopen");
    await page.goto(`${base.origin}${pullsPath}`);
    await expect(page.getByText("No open pull requests.")).toBeVisible();
    await page.getByRole("button", { name: "Closed", exact: true }).click();
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
    const search = page.getByRole("textbox", { name: "Search pull requests..." });
    await search.fill("no-such-pull-request");
    await expect(page.getByText("No closed pull requests.")).toBeVisible();
    await search.fill("verification");
    await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
    await capture("list");
    const otherPulls = `${base.origin}${orgPath}/repositories/${otherRepository}/pulls`;
    await page.goto(`${otherPulls}?state=closed`);
    await expect(page.getByText("No closed pull requests.")).toBeVisible();
    await page.goto(`${otherPulls}/${changeset.id}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.goto(detail);
    await stateBadge("Closed").click();
    await expect(statusMenu.getByRole("button")).toHaveText(["Reopen pull request"]);
    await capture("status-menu-closed", false);
    await menuAction("Reopen pull request").click();
    await expect(openBadge).toBeFocused();
    await close.click();
    await expect(stateBadge("Closed")).toBeVisible();
    await reopen.click();
    await expect(openBadge).toBeVisible();

    const waitForWrite = (browserPage: typeof page, suffix: RegExp) => browserPage.waitForResponse(response =>
      response.request().method() === "POST" && suffix.test(new URL(response.url()).pathname));
    const verifyAndApprove = async () => {
      const conversationURL = page.url();
      await page.getByRole("tab", { name: /Checks/ }).click();
      const evaluation = waitForWrite(page, /\/evaluations$/);
      await page.getByRole("button", { name: /Run (checks|evaluation)/i }).click();
      expect((await evaluation).ok()).toBeTruthy();
      await expect(checksTab).toHaveAccessibleName("Checks 1");
      await expect(page.getByText("All checks passed", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()?.width);
      await capture("checks");
      await conversationTab.click();
      await selectOption(page, page.getByRole("combobox", { name: "Reviewers" }), "Pull Request Reviewer");
      const assignment = waitForWrite(page, /\/reviews$/);
      await page.getByRole("button", { name: /Assign review/i }).click();
      expect((await assignment).ok()).toBeTruthy();
      await reviewer.goto(conversationURL);
      const decision = waitForWrite(reviewer, /\/reviews\/[^/]+\/decision$/);
      await reviewer.getByRole("button", { name: "Approve", exact: true }).click();
      expect((await decision).ok()).toBeTruthy();
      await page.reload();
      await expect(merge).toBeEnabled();
    };
    await verifyAndApprove();
    const settingsEndpoint = `**/api/v1/organizations/${orgID}/repositories/${repository}/settings?target_branch=release`;
    await page.route(settingsEndpoint, route => route.fulfill({ json: {
      default_branch: "release", ref_rules: [{ enabled: true, require_merge_queue: true }],
    } }));
    await page.reload();
    const openQueue = page.getByRole("link", { name: "Open merge queue", exact: true });
    await expect(openQueue).toBeVisible();
    await expect(merge).toHaveCount(0);
    await expect(openQueue).toHaveAttribute("href", `${orgPath}/pipelines?${new URLSearchParams({
      queueRepository: repository, queueTarget: "release", queueSource: "feature/docs",
    })}`);
    await page.unroute(settingsEndpoint);
    await page.reload();
    await expect(merge).toBeEnabled();
    gitAt(checkout, "switch", "--quiet", "feature/docs");
    const secondHead = commit("# Documentation\n\nFirst revision.\nSecond revision.\n", "Clarify revision notes");
    gitAt(checkout, "push", "--quiet", repositoryDir, "HEAD:refs/heads/feature/docs");
    await page.getByRole("button", { name: "Update revision" }).click();
    await expect(merge.filter({ visible: true }).and(page.locator(":enabled"))).toHaveCount(0);
    await expect(page.getByText("This comment was made on an older revision", { exact: true })).toBeVisible();
    await expect(checksTab).toHaveAccessibleName("Checks 0");
    await expect(commitsTab).toHaveAccessibleName("Commits 2");
    await expect(page.getByText("Revision 2", { exact: true })).toBeVisible();
    expect(await post("pull-request/comments", { body: "Outdated", revision_id: changeset.revisions[0].id, path: "README.md", side: "right", line: 3 })).toEqual({ status: 409, detail: "The inline comment revision is not current" });
    expect(await post("merge", { target_ref: "release" })).toEqual({ status: 409, detail: "a passed evaluation is required" });
    await verifyAndApprove();

    const updatedTitle = "Document the verified delivery workflow";
    await editTitle.click();
    await titleInput.fill(`  ${updatedTitle}  `);
    await capture("title-edit");
    const titleUpdated = page.waitForResponse(response =>
      response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/pull-request/title"));
    await titleInput.press("Enter");
    expect((await titleUpdated).status()).toBe(200);
    await expect(page.getByRole("heading", { name: updatedTitle, exact: true })).toBeVisible();
    await expect(editTitle).toBeFocused();
    await expect(merge).toBeEnabled();
    await expect(page.getByText("Changed pull request title", { exact: true })).toBeVisible();
    await capture("title-saved");
    await page.goto(`${base.origin}${pullsPath}`);
    await page.getByRole("link", { name: new RegExp(updatedTitle) }).click();
    await expect(page).toHaveURL(detail);
    await expect(page.getByRole("heading", { name: updatedTitle, exact: true })).toBeVisible();
    await expect(checksTab).toHaveAccessibleName("Checks 1");
    await expect(page.getByText("Revision 2", { exact: true })).toBeVisible();

    await page.goto(`${base.origin}${repositoryPath}/settings`);
    const mergeCommits = page.getByRole("checkbox", { name: "Allow merge commits" });
    await mergeCommits.uncheck();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("General settings saved.")).toBeVisible();
    await page.reload();
    await expect(mergeCommits).not.toBeChecked();
    await capture("general-merge-methods");
    const squashMessageFormat = page.getByRole("combobox", { name: "Squash commit message" });
    await selectOption(page, squashMessageFormat, "Pull request title and description");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("General settings saved.")).toBeVisible();
    await page.reload();
    await expect(squashMessageFormat).toContainText("Pull request title and description");
    await capture("general-merge-message");
    const autoClose = page.getByRole("checkbox", { name: "Auto-close issues with merged pull requests" });
    await expect(autoClose).toBeChecked();
    await autoClose.uncheck();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("General settings saved.")).toBeVisible();
    await page.reload();
    await expect(autoClose).not.toBeChecked();
    await autoClose.check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("General settings saved.")).toBeVisible();
    await capture("general-auto-close-issues");
    await page.getByRole("button", { name: "Change default branch" }).click();
    await selectOption(page, page.getByRole("combobox", { name: "New default branch" }), "release");
    await page.locator("form").filter({ has: page.getByRole("combobox", { name: "New default branch" }) })
      .getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Update default branch" }).click();
    await expect(page.getByText("Default branch updated.")).toBeVisible();
    await reviewer.goto(`${repositoryUrl}/issues/2`);
    const keywordLink = development.getByRole("link", { name: updatedTitle, exact: true });
    await expect(keywordLink).toBeVisible();
    await expect(keywordLink).toHaveAttribute("href", `${pullsPath}/${changeset.id}`);
    await reviewer.screenshot({ path: testInfo.outputPath("issue-pull-request-keyword-development.png"), animations: "disabled" });
    await page.goto(detail);
    expect(await post("merge", { target_ref: "release", merge_method: "merge" })).toEqual({
      status: 409, detail: "Choose an enabled method for this target branch",
    });
    expect(git("rev-parse", "refs/heads/release")).toBe(target);
    const method = page.getByRole("combobox", { name: "Merge method" });
    await method.click();
    const methods = page.getByRole("listbox").getByRole("option");
    await expect(methods).toHaveCount(2);
    await expect(methods.nth(0)).toHaveAccessibleName("Squash and merge");
    await expect(methods.nth(1)).toHaveAccessibleName("Rebase and merge");
    await method.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("pull-request-merge-methods.png"), animations: "disabled" });
    await page.goto(`${base.origin}${repositoryPath}/actions`);
    await page.locator(".repo-actions-rail").getByRole("button", { name: "New workflow" }).click();
    const workflowDialog = page.getByRole("dialog", { name: "Create pipeline" });
    await workflowDialog.getByRole("radio", { name: "Check then approve" }).check();
    await workflowDialog.getByLabel("Workflow name").fill("release-ci");
    await workflowDialog.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("button", { name: "Publish version" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Published version 1" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Actions" }).click();
    await page.getByRole("button", { name: "Triggers" }).click();
    const triggers = page.getByRole("dialog", { name: "Triggers" });
    await triggers.getByRole("button", { name: "Enable trigger" }).click();
    await expect(triggers.getByText("Changeset revision · Version 1")).toBeVisible();
    await triggers.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto(`${base.origin}${repositoryPath}/settings/rulesets`);
    const picker = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import JSON" }).click();
    await (await picker).setFiles({ name: "ci.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      name: "Release merge methods", target: "branch", enforcement: "active", bypass_actors: [],
      conditions: { ref_name: { include: ["refs/heads/release"], exclude: [] } },
      rules: [
        { type: "deletion" }, { type: "non_fast_forward" },
        { type: "pull_request", parameters: {
          allowed_merge_methods: ["merge", "squash"], required_approving_review_count: 0,
          require_extra_approval_for_unattributed_changes: true,
        } },
        { type: "required_status_checks", parameters: {
          strict_required_status_checks_policy: true, do_not_enforce_on_create: false,
          required_status_checks: [{ context: "release-ci", integration_id: 15368 }],
        } },
      ],
    })) });
    const addMapped = page.getByRole("button", { name: "Add mapped ruleset" });
    await expect(addMapped).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await selectOption(page, page.getByRole("combobox", { name: /release-ci.*GitHub App/ }), /^release-ci \(/);
    await capture("github-check-mapping");
    await addMapped.click();
    const requireChecks = page.getByRole("checkbox", { name: "Require status checks to pass" });
    const strictChecks = page.getByRole("checkbox", { name: "Require the source branch to be up to date before merging" });
    const allowedMethods = page.getByRole("group", { name: "Allowed merge methods" });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Rulesets saved.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Edit Release merge methods", exact: true }).click();
    await expect(allowedMethods.getByRole("checkbox", { name: "Rebase", exact: true })).not.toBeChecked();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("repository-ruleset-allowed-merge-methods-live.png"), animations: "disabled", fullPage: true });
    await expect(page.getByRole("checkbox", { name: "release-ci", exact: true })).toBeChecked();
    await expect(strictChecks).toBeChecked();
    await page.getByRole("group", { name: "Required repository workflows" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("repository-settings-required-workflows.png"), animations: "disabled" });
    await page.goto(detail);
    await expect(merge).toBeDisabled();
    await capture("required-workflow-blocked");
    await checksTab.click();
    await expect(page.getByRole("heading", { name: "Required repository workflows" })).toBeVisible();
    await expect(page.getByText("release-ci", { exact: true })).toBeVisible();
    await expect(page.getByText("Waiting for a passing run", { exact: true })).toBeVisible();
    expect(await post("merge", { target_ref: "release", merge_method: "squash" })).toMatchObject({
      status: 409, detail: expect.stringContaining("required repository workflows have not passed"),
    });
    expect(git("rev-parse", "refs/heads/release")).toBe(target);
    await capture("required-workflow-status");
    await page.goto(`${base.origin}${repositoryPath}/settings/rulesets`);
    await page.getByRole("button", { name: "Edit Release merge methods", exact: true }).click();
    await requireChecks.uncheck();
    const requireResolution = page.getByRole("checkbox", { name: "Require conversation resolution before merging" });
    await requireResolution.check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Rulesets saved.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Edit Release merge methods", exact: true }).click();
    await expect(requireResolution).toBeChecked();
    await capture("ruleset-conversation-resolution");
    await page.goto(detail);
    await expect(merge).toBeDisabled();
    const resolutionBlock = "resolve all inline pull request conversations before merging";
    expect(await post("merge", { target_ref: "release", merge_method: "squash" })).toEqual({
      status: 409, detail: resolutionBlock,
    });
    expect(git("rev-parse", "refs/heads/release")).toBe(target);
    const resolve = page.getByRole("button", { name: "Resolve conversation", exact: true });
    const reopenConversation = page.getByRole("button", { name: "Reopen conversation", exact: true });
    await expect(page.getByText("This comment was made on an older revision", { exact: true })).toBeVisible();
    await capture("unresolved-review-thread");
    await resolve.click();
    await expect(merge).toBeEnabled();
    await page.reload();
    await expect(reopenConversation).toBeVisible();
    await capture("resolved-review-thread");
    await reopenConversation.click();
    await expect(merge).toBeDisabled();
    await resolve.click();
    await expect(merge).toBeEnabled();
    expect(await post("merge", { target_ref: "release", merge_method: "rebase" })).toEqual({
      status: 409, detail: "Choose an enabled method for this target branch",
    });
    expect(git("rev-parse", "refs/heads/release")).toBe(target);
    await method.click();
    await expect(methods).toHaveCount(1);
    await expect(methods.first()).toHaveAccessibleName("Squash and merge");
    await method.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("pull-request-ruleset-merge-methods.png"), animations: "disabled" });
    await page.getByRole("option", { name: "Squash and merge" }).click();
    await merge.click();
    await expect(page.getByRole("dialog")).toContainText("Squash and merge");
    await page.getByRole("dialog").getByRole("button", { name: "Merge pull request" }).click();
    await expect(page.getByText("Merged", { exact: true }).first()).toBeVisible();
    const mergedHead = git("rev-parse", "refs/heads/release");
    expect(git("rev-parse", "refs/heads/main")).toBe(target);
    expect(mergedHead).not.toBe(secondHead);
    expect(git("show", "-s", "--format=%P", mergedHead).split(" ")).toEqual([target]);
    expect(git("show", "-s", "--format=%B", mergedHead)).toBe(`${updatedTitle}\n\nA real pull request from the Git test repository. Fixes: #2.`);
    expect(git("show", "refs/heads/release:README.md")).toContain("Second revision.");
    await page.reload();
    await expect(page.getByText("Merged", { exact: true }).first()).toBeVisible();
    await expect(stateBadge("Merged")).toHaveCount(0);
    await capture("merged");
    const issuePage = await page.context().newPage();
    try {
      await issuePage.goto(`${repositoryUrl}/issues/1`);
      await expect(issuePage.getByRole("button", { name: "Reopen issue", exact: true })).toBeVisible();
      await issuePage.screenshot({ path: testInfo.outputPath("issue-closed-after-default-branch-merge.png"), animations: "disabled" });
      await issuePage.goto(`${repositoryUrl}/issues/2`);
      await expect(issuePage.getByRole("button", { name: "Reopen issue", exact: true })).toBeVisible();
      await issuePage.screenshot({ path: testInfo.outputPath("issue-closed-by-pull-request-keyword.png"), animations: "disabled" });
    } finally {
      await issuePage.close();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await editTitle.click();
    await expect(titleInput).toBeFocused();
    await titleInput.fill("Document the verified delivery workflow on mobile");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await expect(saveTitle).toBeEnabled();
    await capture("title-edit-mobile");
    await cancelTitle.click();
    await expect(conversationTab).toHaveAttribute("aria-selected", "true");
    await filesTab.click();
    await expect(filesTab).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await checksTab.click();
    await expect(page.getByText("All checks passed", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await conversationTab.click();
    await capture("mobile");
    await expect(currentSection).toHaveText("Pull requests");
    await capture("repository-pr-mobile", false);
    const settings = repoNav.getByRole("link", { name: "Settings", exact: true });
    await settings.focus();
    await expect(settings).toBeInViewport({ ratio: 1 });
    await settings.press("Enter");
    await expect(page).toHaveURL(`${base.origin}${repositoryPath}/settings`);
    await expect(currentSection).toHaveText("Settings");
  } finally {
    await reviewerContext.close();
    rmSync(checkout, { recursive: true, force: true });
    rmSync(repositoryDir, { recursive: true, force: true });
    rmSync(otherRepositoryDir, { recursive: true, force: true });
  }
});
