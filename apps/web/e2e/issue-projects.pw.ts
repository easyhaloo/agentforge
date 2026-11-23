import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { demoOrganization, installApiMocks } from "./support/api-mocks";
import { selectOption } from "./support/select-option";

test("opens project creation as a page, cancels, and retries a duplicate name", async ({ page }) => {
  await installApiMocks(page);
  const index = `/orgs/${demoOrganization.slug}/projects`;
  const organizationAPI = `/api/v1/organizations/${demoOrganization.id}`;
  const projectsAPI = `${organizationAPI}/issue-projects`;
  const existing = { id: "project-existing", number: 7, name: "Release roadmap", layout: "table" };
  const created = { id: "project-new", number: 19, name: "Release follow-up", layout: "board" };
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
  await page.route((url) => url.pathname === `${organizationAPI}/issues` && url.searchParams.has("project_id"), (route) =>
    route.fulfill({ json: { items: [], total: 0, open_total: 0, closed_total: 0, limit: 30, offset: 0 } }),
  );

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
  const submit = page.getByRole("button", { name: "Create project", exact: true });
  await submit.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(`${index}/new`);
  await expect(name).toHaveValue(existing.name.toUpperCase());
  await expect(board).toBeChecked();

  await name.fill(created.name);
  const issueList = page.waitForRequest((request) => {
    const { pathname, searchParams } = new URL(request.url());
    return request.method() === "GET" && pathname === `${organizationAPI}/issues` && searchParams.get("project_id") === created.id;
  });
  await submit.click();
  await expect(page).toHaveURL(`${index}/${created.number}`);
  await issueList;
  await expect(page.getByRole("heading", { name: "Open 0" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Closed 0" })).toBeVisible();
  expect(submissions).toEqual([
    expect.objectContaining({ name: existing.name.toUpperCase(), layout: "board" }),
    expect.objectContaining({ name: created.name, layout: "board" }),
  ]);
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
    await page.getByRole("button", { name: "Create repository", exact: true }).click();
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
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(`${origin}${organization}/projects/1`);
  const orgProjectURL = page.url();
  await expect(page.getByRole("button", { name: "Board", exact: true })).toHaveAttribute("aria-pressed", "true");
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
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(page).toHaveURL(`${target}/issues/1`);
  await page.reload();
  await expect(page.getByText(orgProject, { exact: true })).toBeVisible();
  await expect(page.getByText(repoProject, { exact: true })).toBeVisible();

  await page.goto(orgProjectURL);
  await expect(page.getByRole("heading", { name: "Open 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Verify project associations" })).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("table").getByRole("link", { name: "Verify project associations" })).toBeVisible();

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
    await page.getByRole("button", { name: "Create issue" }).click();
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
