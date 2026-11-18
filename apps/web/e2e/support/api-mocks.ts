import type { Page } from "@playwright/test";

export const now = "2026-11-17T09:00:00.000Z";
export const demoOrganization = { id: "org-demo", slug: "demo", name: "AgentForge Demo", role: "owner" };
export const labsOrganization = { id: "org-labs", slug: "labs", name: "AgentForge Labs", role: "admin" };

type MockChangeset = {
  changeset: {
    id: string;
    created_by: string;
    repository: string;
    title: string;
    revisions: Array<Record<string, unknown>>;
    evaluations: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown>>;
    reviews: Array<Record<string, unknown>>;
    merge?: Record<string, unknown>;
    audit: Array<Record<string, unknown>>;
  };
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export const storedChangeset = (id: string, title: string, repository = "easyhaloo/agentforge", status = "draft"): MockChangeset => ({
  changeset: {
    id, created_by: "user-owner", repository, title, revisions: [], evaluations: [],
    evidence: [], reviews: [], audit: [],
  },
  status, version: 1, created_at: now, updated_at: now,
});

/** A changeset the server already carried through part of its lifecycle. */
const reviewedChangeset = (id: string, title: string, status: string, reviewStatus = "pending"): MockChangeset => ({
  changeset: {
    id, created_by: "user-owner", repository: "easyhaloo/agentforge", title,
    revisions: [{ id: "rev-1", ref: "main", commit_sha: "sha-main", created_at: now }],
    evaluations: [{ id: "eval-1", revision_id: "rev-1", status: "passed", summary: "Trusted evaluation passed.", created_at: now }],
    evidence: [{ id: "ev-1", revision_id: "rev-1", evaluation_id: "eval-1", kind: "report", uri: "artifact://report", sha256: "abc123", status: "active", created_at: now }],
    reviews: [{ id: "rev-review-1", revision_id: "rev-1", reviewer: "user-owner", status: reviewStatus, comment: "Please review", created_at: now }],
    audit: [],
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
  let repositories = [{
    id: "repo-demo", organization_id: "org-demo", slug: "easyhaloo/agentforge", default_branch: "main",
    created_by: "user-owner", created_at: now, updated_at: now,
  }];
  let changesets: MockChangeset[] = [
    reviewedChangeset("CS-E2E-01", "Browser test baseline", "in_review"),
    storedChangeset("CS-E2E-03", "Unrelated change", "other/repository", "draft"),
    reviewedChangeset("CS-E2E-04", "Approved change", "ready_to_merge", "approved"),
  ];
  let created = 0;

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
      return json({ items: repositories });
    }
    if (path.endsWith("/repositories") && method === "POST") {
      const body = request.postDataJSON() as { slug: string; default_branch: string };
      const added = {
        id: `repo-${repositories.length + 1}`, organization_id: "org-demo", slug: body.slug, default_branch: body.default_branch,
        created_by: "user-owner", created_at: now, updated_at: now,
      };
      repositories = [...repositories, added];
      return json(added, 201);
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
    if (path.includes("/changesets/")) {
      // The server owns the lifecycle: every mutation moves the changeset and answers with its new state.
      const [, tail = ""] = path.split("/changesets/");
      const [id = "", ...rest] = tail.split("/");
      const found = changesets.find((item) => item.changeset.id === id);
      if (!found) return json({ title: "Changeset not found", detail: "The changeset does not exist in this organization" }, 404);
      if (method === "GET" && rest.length === 0) return json(found);
      if (method === "POST" && rest.join("/") === "revisions") {
        const body = request.postDataJSON() as { ref: string };
        found.changeset.revisions.push({ id: `rev-${found.changeset.revisions.length + 1}`, ref: body.ref, commit_sha: `sha-${body.ref}`, created_at: now });
        found.changeset.reviews = found.changeset.reviews.map((entry) => ({ ...entry, status: "stale" }));
        found.status = "evaluation_pending";
        return json(found);
      }
      if (method === "POST" && rest.join("/") === "evaluations") {
        const revisionID = found.changeset.revisions.at(-1)?.id ?? "";
        const evaluation = { id: `eval-${found.changeset.evaluations.length + 1}`, revision_id: revisionID, status: "passed", summary: "Trusted evaluation passed.", created_at: now };
        found.changeset.evaluations.push(evaluation);
        found.changeset.evidence.push({ id: `ev-${found.changeset.evidence.length + 1}`, revision_id: revisionID, evaluation_id: evaluation.id, kind: "report", uri: "artifact://report", sha256: "abc123", status: "active", created_at: now });
        found.status = "review_required";
        return json(found);
      }
      if (method === "POST" && rest.join("/") === "reviews") {
        const body = request.postDataJSON() as { reviewer_id: string; comment: string };
        found.changeset.reviews.push({ id: `rev-review-${found.changeset.reviews.length + 1}`, revision_id: found.changeset.revisions.at(-1)?.id ?? "", reviewer: body.reviewer_id, status: "pending", comment: body.comment, created_at: now });
        found.status = "in_review";
        return json(found);
      }
      if (method === "POST" && rest[0] === "reviews" && rest[2] === "decision") {
        const body = request.postDataJSON() as { approved: boolean; comment: string };
        const review = found.changeset.reviews.find((entry) => entry.id === rest[1]);
        if (review) {
          review.status = body.approved ? "approved" : "rejected";
          review.comment = body.comment;
        }
        found.status = body.approved ? "ready_to_merge" : "changes_requested";
        return json(found);
      }
      if (method === "POST" && rest.join("/") === "merge") {
        const body = request.postDataJSON() as { target_ref: string };
        found.changeset.merge = { id: "merge-1", revision_id: found.changeset.revisions.at(-1)?.id ?? "", actor: "user-owner", target_ref: body.target_ref, commit_sha: "sha-merge", created_at: now };
        found.status = "merged";
        return json(found);
      }
    }
    if (path.endsWith("/changesets") && method === "GET") {
      // The server owns the filters and the status: the mock answers with the matching rows and their total.
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const repository = url.searchParams.get("repository") ?? "";
      const status = url.searchParams.get("status") ?? "";
      const reviewer = (url.searchParams.get("reviewer") ?? "").replace(/^me$/, "user-owner");
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
      created += 1;
      const item = storedChangeset(`CS-E2E-NEW-${created}`, body.title, body.repository);
      changesets = [item, ...changesets];
      return json(item, 201);
    }
    return json({ title: "Unexpected test API request", detail: method + " " + path }, 404);
  });
}
