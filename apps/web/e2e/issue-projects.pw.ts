import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { demoOrganization, installApiMocks } from "./support/api-mocks";
import { selectOption } from "./support/select-option";

test("opens project creation as a page, cancels, and retries a duplicate name", async ({ page }) => {
  await installApiMocks(page);
  const index = `/orgs/${demoOrganization.slug}/projects`;
  const organizationAPI = `/api/v1/organizations/${demoOrganization.id}`;
  const projectsAPI = `${organizationAPI}/issue-projects`;
  const existing = { id: "project-existing", number: 7, name: "Release roadmap", layout: "table" };
  const created = { id: "project-new", number: 19, name: "Release follow-up", layout: "board", version: 1 };
  const items = [existing];
  const submissions: unknown[] = [];

  await page.route((url) => url.pathname === projectsAPI, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fulfill({ json: { items } });

    const body = request.postDataJSON() as { name: string; layout: string };
    submissions.push(body);
    if (body.name.toLowerCase() === existing.name.toLowerCase()) {
      return route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        json: { type: "about:blank", status: 409, title: "Project name in use", detail: "Choose another name in this scope" },
      });
    }
    items.push(created);
    return route.fulfill({ status: 201, json: created });
  });
  await page.route((url) => url.pathname === `${projectsAPI}/${created.number}`, (route) => route.fulfill({ json: created }));
  await page.route((url) => url.pathname === `${projectsAPI}/${created.number}/items`, (route) => route.fulfill({ json: { items: [] } }));

  await page.goto("/projects");
  await expect(page).toHaveURL(index);
  const newProject = page.getByRole("link", { name: "New project", exact: true });
  await newProject.click();
  await expect(page).toHaveURL(`${index}/new`);
  await expect(page.getByRole("heading", { level: 1, name: "New project", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("Canceled draft");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(index);
  expect(submissions).toHaveLength(0);

  await newProject.click();
  await expect(page).toHaveURL(`${index}/new`);
  const board = page.getByRole("radio", { name: "Board", exact: true });
  await expect(page.getByRole("radio", { name: "Table", exact: true })).toBeVisible();
  await board.check();
  await name.fill(existing.name.toUpperCase());
  const submit = page.getByRole("button", { name: "New project", exact: true });
  await submit.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(`${index}/new`);
  await expect(name).toHaveValue(existing.name.toUpperCase());
  await expect(board).toBeChecked();

  await name.fill(created.name);
  await submit.click();
  await expect(page).toHaveURL(`${index}/${created.number}`);
  await expect(page.getByRole("heading", { name: "Todo 0" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Done 0" })).toBeVisible();
  expect(submissions).toEqual([
    expect.objectContaining({ name: existing.name.toUpperCase(), layout: "board" }),
    expect.objectContaining({ name: created.name, layout: "board" }),
  ]);
});

async function openProjectAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Project actions" }).click();
  await page.getByRole("dialog", { name: "Project actions" }).getByRole("link", { name, exact: true }).click();
}

test("keeps project views and project actions usable on a narrow screen", async ({ page }) => {
  await installApiMocks(page);
  await page.setViewportSize({ width: 320, height: 844 });
  const index = `/orgs/${demoOrganization.slug}/projects`;
  const api = `/api/v1/organizations/${demoOrganization.id}/issue-projects`;
  const project = {
    id: "release", number: 7, name: "Release roadmap", layout: "table", version: 1,
    views: [
      { id: "default", name: "Table", layout: "table", filter: "", sort: "manual", group: "none" },
      { id: "board", name: "Board", layout: "board", filter: "", sort: "manual", group: "status" },
    ],
  };
  await page.route((url) => url.pathname === api, (route) => route.fulfill({
    json: { items: [project, { id: "closed", number: 8, name: "Last release", closed: true }] },
  }));
  await page.route((url) => url.pathname.startsWith(`${api}/7`), (route) => route.fulfill({
    json: route.request().url().endsWith("/7") ? project : { items: [] },
  }));

  await page.goto(index);
  const closed = page.getByRole("button", { name: "Closed", exact: true });
  await closed.click();
  await expect(closed).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Last release" })).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search project name or number" }).fill("#7");
  await page.getByRole("link", { name: project.name }).click();

  const views = page.getByRole("navigation", { name: "Project view" });
  const board = views.getByRole("link", { name: "Board", exact: true });
  await board.press("Enter");
  await expect(page).toHaveURL(`${index}/7?view=board`);
  await expect(board).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Todo 0" })).toBeVisible();
  const actions = page.getByRole("button", { name: "Project actions" });
  await actions.press("Enter");
  const menu = page.getByRole("dialog", { name: "Project actions" });
  await expect(menu.getByRole("link", { name: "Updates" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(actions).toBeFocused();
  await openProjectAction(page, "Archived items");
  await expect(page).toHaveURL(`${index}/7?view=board&page=archive`);
  await expect(page.getByRole("heading", { name: "Archived items" })).toBeVisible();
});

const origin = process.env.AGENTFORGE_TEST_ORIGIN;

test("persists scoped projects from the issue composer", async ({ page }) => {
  test.skip(!origin, "Requires the local Go API and PostgreSQL");
  const password = randomUUID();
  await page.goto(`${origin}/register`);
  await page.locator('[name=email]').fill(`${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill("Project QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  const organization = new URL(page.url()).pathname.replace(/\/changesets$/, "");

  async function createRepository(name: string) {
    await page.goto(`${origin}${organization}/repositories/new`);
    await page.getByLabel("Repository name", { exact: true }).fill(name);
    await page.getByRole("switch", { name: /Add a README/ }).press("Space");
    await page.getByRole("button", { name: "New repository", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/repositories/[^/]+/${name}$`));
    return page.url();
  }
  const target = await createRepository("project-walkthrough");
  const sibling = await createRepository("other-project-repo");
  const targetSlug = target.split("/repositories/")[1];

  const orgProject = "Release roadmap";
  const repoProject = "Repository triage";
  const organizationHandle = organization.split("/").at(-1);
  await page.goto(`${origin}${organization}/projects`);
  await page.getByRole("link", { name: "New project", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill(orgProject);
  await page.getByRole("radio", { name: "Board", exact: true }).check();
  await selectOption(page, page.getByRole("combobox", { name: "Default repository (optional)" }), targetSlug);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await expect(page).toHaveURL(`${origin}${organization}/projects/1`);
  const orgProjectURL = page.url();
  await expect(page.getByRole("link", { name: "Board", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "New issue", exact: true })).toHaveAttribute("href", new RegExp(`${targetSlug}/issues/new\\?projects=`));

  // The legacy single-repository scope is still supported by the API.
  const repoProjectNumber = await page.evaluate(async ({ organizationHandle, repoProject, targetSlug }) => {
    const accountResponse = await fetch("/api/v1/me");
    if (!accountResponse.ok) throw new Error(`Could not load account for fixtures (${accountResponse.status})`);
    const account = await accountResponse.json() as { organizations: { id: string; slug?: string }[] };
    const org = account.organizations.find(({ slug, id }) => (slug || id) === organizationHandle);
    const csrf = document.cookie.match(/(?:^|; )__Host-agentforge_csrf=([^;]+)/)?.[1];
    if (!org || !csrf) throw new Error("Missing organization or browser CSRF cookie for project fixtures");

    const endpoint = `/api/v1/organizations/${encodeURIComponent(org.id)}/issue-projects`;
    const headers = { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) };
    async function createProject(name: string, repository: string) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, repository, layout: "table" }),
      });
      if (response.status !== 201) throw new Error(`Could not create project fixture (${response.status})`);
      return await response.json() as { number: number };
    }

    return (await createProject(repoProject, targetSlug)).number;
  }, { organizationHandle, repoProject, targetSlug });

  await page.goto(`${target}/issues`);
  await page.getByRole("link", { name: "New issue", exact: true }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Verify project associations");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Project links must survive publish and refresh.");
  const metadata = page.getByRole("button", { name: /^Issue metadata/ });
  const picker = page.getByRole("dialog", { name: "Issue metadata" });
  await metadata.click();
  const projects = picker.getByRole("group", { name: "Projects", exact: true });
  await projects.getByRole("group", { name: "Organization", exact: true }).getByLabel(orgProject).check();
  await projects.getByRole("group", { name: "Repository", exact: true }).getByLabel(repoProject).check();
  await expect(metadata).toHaveText("Issue metadata (2)");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByRole("tabpanel", { name: "Preview" })).toContainText("Project links must survive publish and refresh.");
  await page.getByRole("button", { name: "New issue" }).click();
  await expect(page).toHaveURL(`${target}/issues/1`);
  await page.reload();
  await expect(page.getByText(orgProject, { exact: true })).toBeVisible();
  await expect(page.getByText(repoProject, { exact: true })).toBeVisible();

  await page.goto(orgProjectURL);
  await expect(page.getByRole("heading", { name: "Todo 1" })).toBeVisible();
  await selectOption(page, page.getByRole("combobox", { name: "Move Verify project associations" }), "In progress");
  await expect(page.getByRole("heading", { name: "In progress 1" })).toBeVisible();
  await page.goto(`${orgProjectURL.replace(/\/1$/, `/${repoProjectNumber}`)}`);
  await expect(page.getByRole("table").getByRole("cell", { name: "Todo", exact: true })).toBeVisible();
  await page.goto(orgProjectURL);
  await page.getByRole("link", { name: "New view" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "View name" }).fill("All items");
  await page.getByRole("button", { name: "New view" }).click();
  await expect(page.getByRole("table").getByRole("link", { name: "Verify project associations" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "All items", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto(`${target}/issues/new`);
  await metadata.click();
  const recent = projects.getByRole("group", { name: "Recent", exact: true });
  await expect(recent.getByLabel(orgProject)).toBeVisible();
  await expect(recent.getByLabel(repoProject)).toBeVisible();
  await page.goto(`${sibling}/issues/new`);
  await metadata.click();
  await expect(recent.getByLabel(orgProject)).toBeVisible();
  await expect(projects.getByLabel(repoProject)).toHaveCount(0);

  await test.step("PROJECT-05: preselect numbered projects for the current repository only", async () => {
    const title = page.getByRole("textbox", { name: "Title" });
    const query = new URLSearchParams({ title: "Numbered project", projects: `${organizationHandle}/${repoProjectNumber}` });
    await page.goto(`${target}/issues/new?${query}`);
    await expect(metadata).toHaveText("Issue metadata (1)");
    await metadata.click();
    await expect(recent.getByRole("checkbox", { name: repoProject, exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "New issue" }).click();
    await expect(page).toHaveURL(`${target}/issues/2`);
    await page.reload();
    await expect(page.getByText(repoProject, { exact: true })).toBeVisible();
    await expect(page.getByText(orgProject, { exact: true })).toHaveCount(0);

    for (const [repo, number] of [[sibling, repoProjectNumber], [target, 9999]] as const) {
      const invalidQuery = new URLSearchParams({ title: "Keep the draft", projects: `${organizationHandle}/${number}` });
      await page.goto(`${repo}/issues/new?${invalidQuery}`);
      await expect(page.getByRole("alert")).toHaveText("The issue fields from this link could not be applied.");
      await expect(title).toHaveValue("Keep the draft");
      await expect(metadata).toHaveText("Issue metadata");
    }
  });
});

test("imports across repositories and keeps draft identity through conversion, archive, and reopen", async ({ page }) => {
  test.slow();
  test.skip(!origin, "Requires the local Go API and PostgreSQL");
  await page.goto(`${origin}/register`);
  const password = randomUUID();
  await page.locator('[name=email]').fill(`${randomUUID()}@example.test`);
  await page.locator('[name=displayName]').fill("Projects workspace QA");
  await page.locator('[name=password]').fill(password);
  await page.locator('[name=confirmPassword]').fill(password);
  await page.locator('button[type=submit]').click();
  await expect(page).toHaveURL(/\/orgs\/(?!current\/)[^/]+\/changesets$/);
  const org = page.url().replace(/\/changesets$/, "");
  const createRepo = async (name: string) => {
    await page.goto(`${org}/repositories/new`);
    await page.getByLabel("Repository name", { exact: true }).fill(name);
    await page.getByRole("switch", { name: /Add a README/ }).press("Space");
    await page.getByRole("button", { name: "New repository", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/repositories/[^/]+/${name}$`));
    return page.url();
  };
  const planning = await createRepo("project-planning");
  const source = await createRepo("project-source");
  const sourceSlug = source.split("/repositories/")[1];
  await page.goto(`${source}/issues/new`);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Imported work");
  await page.getByRole("button", { name: "New issue", exact: true }).click();
  await expect(page).toHaveURL(`${source}/issues/1`);
  await page.goto(`${planning}/projects`);
  await page.getByRole("link", { name: "New project", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Release planning");
  await page.getByRole("radio", { name: "Release plan", exact: true }).check();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.getByRole("combobox", { name: "Default repository (optional)" })).toContainText("project-planning");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "New project" }).click();
  const project = `${org}/projects/1`;
  await expect(page).toHaveURL(project);
  await page.getByRole("link", { name: "Add items" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await selectOption(page, page.getByRole("combobox", { name: "Repository", exact: true }), sourceSlug);
  await page.getByRole("checkbox", { name: "#1 Imported work" }).check();
  await page.getByRole("button", { name: "Add selected items" }).click();
  await expect(page.getByRole("link", { name: "Imported work" })).toBeVisible();
  await openProjectAction(page, "Workflows");
  await expect(page).toHaveURL(`${project}?page=workflows`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await selectOption(page, page.getByRole("combobox", { name: "When an issue is closed" }), "In progress");
  await page.getByRole("spinbutton", { name: "Auto-archive after (days)" }).fill("14");
  await selectOption(page, page.getByRole("combobox", { name: "Auto-add repository" }), sourceSlug);
  await expect(page.getByRole("combobox", { name: "Auto-add item type" })).toContainText("Issue");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(project);
  await page.goto(`${source}/issues/1`);
  await page.getByRole("button", { name: "Close issue", exact: true }).click();
  await page.getByRole("dialog", { name: "Close issue" }).getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reopen issue", exact: true })).toBeVisible();
  await page.goto(`${project}?view=removed-view`);
  await expect(page.getByText("This view is unavailable. The default view is shown.")).toBeVisible();
  await page.getByRole("link", { name: "Imported work" }).click();
  await expect(page.getByRole("combobox", { name: "Project status" })).toContainText("In progress");
  await page.goto(project);
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  const history = page.getByRole("region", { name: "Project status history" });
  await expect(history.getByRole("columnheader", { name: "Date (UTC)" })).toBeVisible();
  await expect(history.getByRole("row").nth(1).getByRole("cell").nth(2)).toHaveText("1");
  await page.getByRole("link", { name: "Back to project", exact: true }).click();
  await page.getByRole("link", { name: "Add items" }).click();
  await selectOption(page, page.getByRole("combobox", { name: "Item type" }), "Draft");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Prepare release notes");
  const draftDescription = page.getByRole("textbox", { name: "Description", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await draftDescription.fill("Initial release notes");
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  await page.getByRole("link", { name: "Prepare release notes" }).click();
  const draftURL = page.url();
  await page.goto(project);
  await openProjectAction(page, "Project settings");
  await page.getByRole("link", { name: "Custom fields" }).click();
  await page.getByRole("link", { name: "New field", exact: true }).click();
  await expect(page).toHaveURL(/page=fields&field=new$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Field name" }).fill("Reviewer notes");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "Reviewer notes", exact: true })).toBeVisible();
  await page.goto(draftURL);
  await expect(draftDescription).toHaveValue("Initial release notes");
  await draftDescription.fill("## Release checklist\n\n- Verify the upgrade guide");
  await expect(page.getByRole("button", { name: "Convert to issue" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Reviewer notes" }).fill("Verify upgrade path");
  const savedField = page.waitForResponse((response) => response.request().method() === "PUT" && /\/field-values\//.test(response.url()));
  await page.getByRole("button", { name: "Save Reviewer notes", exact: true }).click();
  expect((await savedField).ok()).toBeTruthy();
  await page.getByLabel("Start date").fill("2026-12-02");
  await page.getByLabel("Target date").fill("2026-12-09");
  await selectOption(page, page.getByRole("combobox", { name: "Project status" }), "In progress");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Dec 2, 2026 – Dec 9, 2026")).toBeVisible();
  await page.getByRole("link", { name: "New view", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "View name", exact: true }).fill("Release table");
  await page.getByRole("button", { name: "New view", exact: true }).click();
  await expect(page.getByRole("link", { name: "Release table", exact: true })).toHaveAttribute("aria-current", "page");
  // The project table must pick up custom columns even when items load first.
  await page.route("**/issue-projects/1/fields", async (route) => {
    await expect(page.getByRole("columnheader", { name: "Title", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    await route.continue();
  }, { times: 1 });
  await page.reload();
  await expect(page.getByRole("columnheader", { name: "Reviewer notes" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Verify upgrade path" })).toBeVisible();
  const tableURL = page.url();
  await page.getByRole("link", { name: "New view", exact: true }).click();
  await page.getByRole("textbox", { name: "View name", exact: true }).fill("Release board");
  await selectOption(page, page.getByRole("combobox", { name: "Layout" }), "Board");
  await page.getByRole("button", { name: "New view", exact: true }).click();
  await expect(page.getByRole("link", { name: "Release board", exact: true })).toHaveAttribute("aria-current", "page");
  const inProgress = page.getByRole("region", { name: "In progress", exact: true });
  const done = page.getByRole("region", { name: "Done", exact: true });
  const importedCard = inProgress.getByRole("listitem").filter({ hasText: "Imported work" });
  await done.getByRole("link", { name: "Add items to Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await selectOption(page, page.getByRole("combobox", { name: "Item type" }), "Draft");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Ready for release");
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  await expect(done.getByRole("link", { name: "Ready for release" })).toBeVisible();
  await importedCard.dragTo(done);
  await expect(done.getByRole("link", { name: "Imported work" })).toBeVisible();
  await page.goto(tableURL);
  await expect(page.getByRole("row").filter({ hasText: "Imported work" }).getByRole("cell", { name: "Done", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Prepare release notes" }).click();
  await page.reload();
  await expect(draftDescription).toHaveValue("## Release checklist\n\n- Verify the upgrade guide");
  await page.getByRole("button", { name: "Convert to issue", exact: true }).first().click();
  await selectOption(page, page.getByRole("combobox", { name: "Repository", exact: true }), sourceSlug);
  // Opening the toolbar action reveals a second "Convert to issue" button in
  // the conversion form (projects.convertConfirm). Target the revealed one.
  await page.getByRole("button", { name: "Convert to issue", exact: true }).last().click();
  await page.getByRole("link", { name: "Prepare release notes" }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]item=${new URL(draftURL).searchParams.get("item")}$`));
  const convertedItemURL = page.url();
  const openIssue = page.getByRole("link", { name: /^Open source in/ });
  await expect(openIssue).toHaveAttribute("href", `${new URL(source).pathname}/issues/2`);
  await openIssue.click();
  const issueDescription = page.getByRole("region", { name: "Description", exact: true });
  await expect(issueDescription.getByRole("heading", { name: "Release checklist" })).toBeVisible();
  await expect(issueDescription.getByRole("listitem")).toHaveText("Verify the upgrade guide");
  await page.goto(convertedItemURL);
  await page.getByRole("button", { name: "Archive item", exact: true }).click();
  await expect(page.getByRole("link", { name: "Prepare release notes" })).toHaveCount(0);
  await page.getByRole("link", { name: "Add items" }).click();
  await page.getByRole("textbox", { name: "Paste an Issue or pull request link" }).fill(`${source}/issues/2`);
  await page.getByRole("button", { name: "Add selected items" }).click();
  await expect(page.getByText("These items are already archived. Open an item to restore it.")).toBeVisible();
  await page.getByRole("link", { name: "Prepare release notes" }).click();
  await page.getByRole("button", { name: "Restore item" }).click();
  await expect(page.getByRole("heading", { name: "Archived items", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to project", exact: true }).click();
  await expect(page.getByRole("link", { name: "Prepare release notes" })).toBeVisible();
  await openProjectAction(page, "Updates");
  await page.getByRole("link", { name: "New update", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await selectOption(page, page.getByRole("combobox", { name: "Health" }), "At risk");
  await page.getByRole("textbox", { name: "Progress update" }).fill("Waiting on **release validation**.");
  await page.getByLabel("Target date").fill("2026-12-09");
  await page.getByRole("button", { name: "Publish update" }).click();
  await expect(page.getByRole("heading", { name: "At risk" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("release validation", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Project details" }).click();
  await expect(page.getByRole("heading", { name: "Latest update" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "At risk" })).toBeVisible();
  await openProjectAction(page, "Project settings");
  await page.getByRole("button", { name: "Close project", exact: true }).click();
  await expect(page.getByText("This project is closed and read-only.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add items" })).toHaveCount(0);
  await page.goto(`${planning}/projects`);
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await page.getByRole("link", { name: "Release planning" }).click();
  await openProjectAction(page, "Project settings");
  await page.getByRole("button", { name: "Reopen project", exact: true }).click();
  await expect(page.getByRole("link", { name: "Add items" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Prepare release notes" })).toBeVisible();

  await page.goto(`${source}/issues/new`);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Follow-up from source repository");
  await page.getByRole("button", { name: "New issue", exact: true }).click();
  await expect(page).toHaveURL((url) => url.href.startsWith(`${source}/issues/`) && /\/issues\/\d+$/.test(url.pathname));
  await expect(page.getByRole("heading", { name: /Follow-up from source repository/ })).toBeVisible();
  await page.goto(project);
  await expect(page.getByRole("link", { name: "Follow-up from source repository" })).toBeVisible();
  await openProjectAction(page, "Workflows");
  await expect(page.getByRole("spinbutton", { name: "Auto-archive after (days)" })).toHaveValue("14");
  await expect(page.getByRole("combobox", { name: "Auto-add repository" })).toContainText(sourceSlug);
  const runs = page.getByRole("region", { name: "Workflow history" }).getByRole("listitem");
  await expect(runs).toHaveCount(2);
  await expect(runs.first()).toContainText("Auto-add");
  await expect(runs.last()).toContainText("When an issue is closed");
  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
