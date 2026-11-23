import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { selectOption } from "./support/select-option";

const origin = process.env.AGENTFORGE_TEST_ORIGIN;
test.skip(!origin, "Requires the local Go API and PostgreSQL");

test("creates scoped projects and persists them from the issue composer", async ({ page }) => {
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

  await page.goto(`${origin}/projects`);
  const panel = page.getByRole("region", { name: "Issue projects" });
  const name = panel.getByRole("textbox", { name: "Project name" });
  const create = panel.getByRole("button", { name: "New issue project" });
  await create.click();
  await expect(panel.getByRole("alert")).toHaveText("Enter a project name.");
  const orgProject = "Release roadmap";
  const repoProject = "Repository triage";
  await name.fill(orgProject);
  await create.click();
  await expect(panel.getByText(orgProject, { exact: true })).toBeVisible();
  await name.fill(orgProject.toUpperCase());
  await create.click();
  await expect(panel.getByRole("alert")).toHaveText("A project with this name already exists in this scope.");
  await selectOption(page, panel.getByRole("combobox", { name: "Project scope" }), targetSlug);
  await name.fill(repoProject);
  await create.click();
  await expect(panel.getByText(repoProject, { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel.getByText(repoProject, { exact: true })).toBeVisible();

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
    const organizationHandle = organization.split("/").at(-1);
    const title = page.getByRole("textbox", { name: "Title" });
    const query = new URLSearchParams({ title: "Numbered project", projects: `${organizationHandle}/2` });
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

    for (const [repo, number] of [[sibling, 2], [target, 9999]] as const) {
      const invalidQuery = new URLSearchParams({ title: "Keep the draft", projects: `${organizationHandle}/${number}` });
      await page.goto(`${repo}/issues/new?${invalidQuery}`);
      await expect(page.getByRole("alert")).toHaveText("The issue fields from this link could not be applied.");
      await expect(title).toHaveValue("Keep the draft");
      await expect(metadata).toHaveText("Issue metadata");
    }
  });
});
