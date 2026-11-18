import type { Page } from "@playwright/test";

export const now = "2026-11-17T09:00:00.000Z";
export const demoOrganization = { id: "org-demo", slug: "demo", name: "AgentForge Demo", role: "owner" };
export const labsOrganization = { id: "org-labs", slug: "labs", name: "AgentForge Labs", role: "admin" };

export const storedChangeset = (id: string, title: string, repository = "easyhaloo/agentforge", status = "draft") => ({
  changeset: {
    id, created_by: "user-owner", repository, title, revisions: [], evaluations: [],
    evidence: [], reviews: [], audit: [],
  },
  status, version: 1, created_at: now, updated_at: now,
});

type MockOptions = {
  /** Organizations returned by /api/v1/me. Defaults to the demo organization only. */
  organizations?: Array<typeof demoOrganization>;
  /** Answer /api/v1/me with 401, like an anonymous visitor. */
  signedOut?: boolean;
};

/** Deterministic stand-in for the backend: no test talks to a real API. */
export async function installApiMocks(page: Page, { organizations = [demoOrganization], signedOut = false }: MockOptions = {}) {
  let members = [{
    user_id: "user-member", display_name: "Alex Developer", email: "alex@example.test",
    role: "member", status: "active", created_at: now, updated_at: now,
  }];
  let invitations: Array<Record<string, unknown>> = [];
  let changesets = [
    storedChangeset("CS-E2E-01", "Browser test baseline", "easyhaloo/agentforge", "in_review"),
    storedChangeset("CS-E2E-03", "Unrelated change", "other/repository", "draft"),
  ];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (path === "/api/v1/me" && method === "GET") {
      if (signedOut) return json({ title: "Unauthorized", detail: "Authentication required" }, 401);
      return json({ user_id: "user-owner", display_name: "Taylor Owner", email: "owner@example.test", organizations });
    }
    if (path === "/api/v1/auth/logout" && method === "POST") {
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/repositories") && method === "GET") {
      return json({ items: [{ id: "repo-demo", slug: "easyhaloo/agentforge", default_branch: "main", created_at: now }] });
    }
    if (path.endsWith("/members") && method === "GET") {
      return json({ items: members, limit: 100, offset: 0 });
    }
    if (path.endsWith("/members/user-member") && method === "PATCH") {
      const update = request.postDataJSON() as { role?: string; status?: string };
      members = members.map((member) => member.user_id === "user-member" ? { ...member, ...update, updated_at: now } : member);
      return json(members[0]);
    }
    if (path.endsWith("/invitations") && method === "GET") {
      return json({ items: invitations, limit: 100, offset: 0 });
    }
    if (path.endsWith("/invitations") && method === "POST") {
      const body = request.postDataJSON() as { email: string; role: string };
      const invitation = {
        id: "invite-e2e-01", email: body.email, role: body.role, status: "pending",
        invited_by: "user-owner", expires_at: "2026-11-24T09:00:00.000Z", created_at: now,
      };
      invitations = [invitation, ...invitations];
      return json({ invitation, invitation_url: "https://agentforge.example.test/invite/e2e-token", token: "e2e-token" }, 201);
    }
    if (path.endsWith("/membership-audit") && method === "GET") {
      return json({ items: [], limit: 100, offset: 0 });
    }
    if (path.includes("/changesets/") && method === "GET") {
      const id = path.slice(path.lastIndexOf("/") + 1);
      const found = changesets.find((item) => item.changeset.id === id);
      if (!found) return json({ title: "Changeset not found", detail: "The changeset does not exist in this organization" }, 404);
      return json(found);
    }
    if (path.endsWith("/changesets") && method === "GET") {
      // The server owns the filters and the status: the mock answers with the matching rows and their total.
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const repository = url.searchParams.get("repository") ?? "";
      const status = url.searchParams.get("status") ?? "";
      const reviewer = url.searchParams.get("reviewer") ?? "";
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const matched = changesets.filter((item) => {
        if (q && ![item.changeset.id, item.changeset.title, item.changeset.repository, item.changeset.created_by]
          .some((field) => field.toLowerCase().includes(q))) return false;
        if (repository && item.changeset.repository !== repository) return false;
        if (status && item.status !== status) return false;
        if (reviewer && !item.changeset.reviews.some((entry) => entry.reviewer === reviewer)) return false;
        return true;
      });
      return json({ items: matched.slice(offset, offset + limit), total: matched.length, limit, offset });
    }
    if (path.endsWith("/changesets") && method === "POST") {
      const body = request.postDataJSON() as { repository: string; title: string };
      const created = storedChangeset("CS-E2E-02", body.title, body.repository);
      changesets = [created, ...changesets];
      return json(created, 201);
    }
    return json({ title: "Unexpected test API request", detail: method + " " + path }, 404);
  });
}
