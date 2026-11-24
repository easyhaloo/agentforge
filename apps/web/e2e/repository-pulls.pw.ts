import { expect, test, type Page } from "@playwright/test";
import { demoOrganization, installApiMocks, storedChangeset } from "./support/api-mocks";
import { selectOption } from "./support/select-option";

const repository = "easyhaloo/agentforge";
const pullID = "CS-native-pr";
const pullPath = `/orgs/demo/repositories/${repository}/pulls/${pullID}`;
const api = "/api/v1/organizations/org-demo";
const project = { id: "project-1", number: 1, name: "Release backlog", layout: "table", version: 1 };
const projectItem = {
  id: "project-item-1", title: "Update release notes", kind: "pull_request", source_id: pullID,
  repository, status: "todo", archived: false, version: 3,
};

async function mockPullProjects(page: Page, role: "owner" | "admin" | "member" | "viewer", initialItem?: typeof projectItem) {
  let item = initialItem;
  await installApiMocks(page, { organizations: [{ ...demoOrganization, role }] });
  const pull = storedChangeset(pullID, projectItem.title, repository);
  await page.route(`**${api}/changesets/${pullID}`, route => route.fulfill({ json: {
    ...pull, changeset: { ...pull.changeset, pull_request: { base_branch: "main", source_branch: "docs", comments: [] } },
  } }));
  await page.route(`**${api}/issue-projects`, route => route.fulfill({ json: { items: [project] } }));
  await page.route(/\/issue-projects\/1\/items(?:\?archived=true)?$/, route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ kind: "pull_request", repository, source_id: pullID });
      item = projectItem;
      return route.fulfill({ status: 201, json: projectItem });
    }
    const archived = new URL(route.request().url()).searchParams.has("archived");
    const items = archived ? [] : [
      { ...projectItem, id: "other-source", source_id: "CS-other-pr" },
      { ...projectItem, id: "other-repo", repository: "other/repo" },
    ];
    if (item && item.archived === archived) items.push(item);
    return route.fulfill({ json: { items } });
  });
  await page.route(`**${api}/issue-projects/1/items/${projectItem.id}?*`, route => {
    expect(route.request().method()).toBe("DELETE");
    expect(new URL(route.request().url()).searchParams.get("version")).toBe(String(projectItem.version));
    item = undefined;
    return route.fulfill({ status: 204 });
  });
}

test("members can associate and remove the native PR from a project", async ({ page }) => {
  await mockPullProjects(page, "member");
  await page.goto(pullPath);
  const projects = page.getByRole("region", { name: "Projects", exact: true });
  await expect(projects.getByText("No linked projects")).toBeVisible();
  await selectOption(page, projects.getByRole("combobox", { name: "Choose a project" }), project.name);
  await projects.getByRole("button", { name: "Add", exact: true }).click();
  await expect(projects.getByRole("link", { name: project.name })).toHaveAttribute("href", "/orgs/demo/projects/1");
  await page.reload();
  await projects.getByRole("button", { name: `Remove from ${project.name}` }).click();
  await expect(projects.getByText("No linked projects")).toBeVisible();
});

test("viewers see PR project links without controls to change them", async ({ page }) => {
  await mockPullProjects(page, "viewer", projectItem);
  await page.goto(pullPath);
  const projects = page.getByRole("region", { name: "Projects", exact: true });
  await expect(projects.getByRole("link", { name: project.name })).toBeVisible();
  await expect(projects.getByRole("combobox")).toHaveCount(0);
  await expect(projects.getByRole("button")).toHaveCount(0);
});

test("admins can remove an archived association without adding a duplicate", async ({ page }) => {
  await mockPullProjects(page, "admin", { ...projectItem, archived: true });
  await page.goto(pullPath);
  const projects = page.getByRole("region", { name: "Projects", exact: true });
  await expect(projects.getByRole("link", { name: project.name })).toBeVisible();
  await expect(projects.getByText("Archived", { exact: true })).toBeVisible();
  await expect(projects.getByRole("combobox")).toHaveCount(0);
  await projects.getByRole("button", { name: `Remove from ${project.name}` }).click();
  await expect(projects.getByText("No linked projects")).toBeVisible();
});
