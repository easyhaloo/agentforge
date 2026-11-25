import { expect, test } from "@playwright/test";
import { installApiMocks } from "./support/api-mocks";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await installApiMocks(page);
});

test("WebIDE saves an overlay and hands it off to the Changeset lifecycle", async ({ page }) => {
  const now = new Date().toISOString();
  const workspace = {
    id: "ws-webide-e2e",
    organization_id: "org-demo",
    repository: "easyhaloo/agentforge",
    owner_id: "user-owner",
    base_commit_sha: "a".repeat(40),
    base_ref: "main",
    status: "active",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: now,
    updated_at: now,
  };
  let savedContent = "base content\n";
  let version = 0;
  let submitted = false;
  let attempted = false;

  await page.route("**/api/v1/organizations/org-demo/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (path === "/api/v1/organizations/org-demo/repositories/easyhaloo/agentforge/workspaces" && method === "POST") {
      return json({ workspace }, 201);
    }
    if (path === "/api/v1/organizations/org-demo/workspaces/ws-webide-e2e/tree" && method === "GET") {
      return json({
        workspace_id: workspace.id,
        base_commit_sha: workspace.base_commit_sha,
        path: "",
        items: [{ name: "README.md", path: "README.md", kind: "file", source: version ? "workspace" : "base", version }],
      });
    }
    if (path === "/api/v1/organizations/org-demo/workspaces/ws-webide-e2e/diff" && method === "GET") {
      return json({
        workspace_id: workspace.id,
        base_commit_sha: workspace.base_commit_sha,
        items: version ? [{ path: "README.md", status: "modified", workspace_sha256: "b".repeat(64), version }] : [],
        total: version ? 1 : 0,
      });
    }
    if (path === "/api/v1/organizations/org-demo/workspaces/ws-webide-e2e/files" && method === "GET") {
      return json({
        workspace_id: workspace.id,
        path: "README.md",
        content: savedContent,
        sha256: "b".repeat(64),
        version,
        source: version ? "workspace" : "base",
      });
    }
    if (path === "/api/v1/organizations/org-demo/workspaces/ws-webide-e2e/files" && method === "PUT") {
      const body = request.postDataJSON() as { path: string; content: string; expected_version: number };
      expect(body).toEqual({ path: "README.md", content: "edited content\n", expected_version: 0 });
      savedContent = body.content;
      version = 1;
      return json({
        workspace_id: workspace.id,
        path: body.path,
        content: savedContent,
        sha256: "b".repeat(64),
        version,
        source: "workspace",
      });
    }
    if (path === "/api/v1/organizations/org-demo/workspaces/ws-webide-e2e/changesets" && method === "POST") {
      if (!attempted) {
        attempted = true;
        expect(request.postDataJSON()).toEqual({ title: "Update easyhaloo/agentforge" });
        return json({ title: "Web commit sign-off required" }, 422);
      }
      expect(request.postDataJSON()).toEqual({ title: "Update easyhaloo/agentforge", signoff: true });
      submitted = true;
      return json({
        changeset: {
          changeset: { id: "cs-webide-e2e" },
          status: "evaluation_pending",
          version: 1,
          created_at: now,
          updated_at: now,
        },
        workspace_id: workspace.id,
        base_commit_sha: workspace.base_commit_sha,
        revision_commit_sha: "c".repeat(40),
      }, 201);
    }
    return route.fallback();
  });

  await page.goto("/orgs/demo/webide/easyhaloo/agentforge");
  await expect(page.getByRole("heading", { name: "Workspace WebIDE" })).toBeVisible();
  await page.getByRole("button", { name: "New workspace" }).click();
  await expect(page.getByRole("button", { name: "README.md" })).toBeVisible();
  await page.getByRole("button", { name: "README.md" }).click();

  const editor = page.getByRole("textbox", { name: "Source editor" });
  await expect(editor).toHaveValue("base content\n");
  await editor.fill("edited content\n");
  await expect(page.getByRole("button", { name: "New changeset" })).toBeDisabled();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: /New changeset/ })).toBeEnabled();
  await page.getByRole("button", { name: "New changeset" }).click();
  const signoff = page.getByRole("checkbox", { name: /I certify this contribution/ });
  await expect(signoff).not.toBeChecked();
  await expect(signoff).toBeVisible();
  await expect(page.getByRole("button", { name: "New changeset" })).toBeDisabled();
  await signoff.check();
  await page.getByRole("button", { name: "New changeset" }).click();
  await expect.poll(() => submitted).toBe(true);
  await expect(page.getByText(/Changeset cs-webide-e2e created from workspace/)).toBeVisible();
});
