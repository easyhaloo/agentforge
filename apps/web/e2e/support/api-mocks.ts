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
    // The audit codes are the server's own; the interface translates them.
    audit: [
      { sequence: 1, actor: "user-owner", operation: "changeset.created", target_id: id, outcome: "succeeded", at: now },
      { sequence: 2, actor: "user-owner", operation: "revision.created", target_id: "rev-1", outcome: "succeeded", at: now },
      { sequence: 3, actor: "user-owner", operation: "review.assigned", target_id: "rev-review-1", outcome: "succeeded", at: now },
      ...(reviewStatus === "pending" ? [] : [{ sequence: 4, actor: "user-owner", operation: "review.decided", target_id: "rev-review-1", outcome: reviewStatus, at: now }]),
    ],
  },
  status, version: 1, created_at: now, updated_at: now,
});

type MockOptions = {
  /** Organizations returned by /api/v1/me. Defaults to the demo organization only. */
  organizations?: Array<typeof demoOrganization & { personal?: boolean }>;
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

  // Issue tracking mock data
  type MockIssue = {
    id: string;
    number: number;
    orgID: string;
    repository: string;
    title: string;
    body: string;
    state: "open" | "closed";
    state_reason?: "completed" | "not_planned" | "duplicate";
    milestone_id?: string;
    locked: boolean;
    comments: number;
    labels: Array<{ id: string; name: string; description: string; color: string; created_at: string }>;
    assignees: Array<{ user_id: string }>;
    created_by: string;
    created_at: string;
    updated_at: string;
    closed_at?: string;
    closed_by?: string;
  };

  const issueResponse = ({ orgID: _orgID, ...issue }: MockIssue) => issue;
  let issues: MockIssue[] = [
    {
      orgID: demoOrganization.id, id: "issue-1", number: 1, repository: "easyhaloo/agentforge",
      title: "Add user authentication", body: "We need to implement user authentication with OAuth2 support.",
      state: "open", locked: false, comments: 5,
      labels: [{ id: "label-1", name: "enhancement", description: "New feature", color: "a2eeef", created_at: now }],
      assignees: [{ user_id: "user-owner" }],
      created_by: "user-owner", created_at: "2026-11-15T10:00:00.000Z", updated_at: "2026-11-16T14:30:00.000Z",
    },
    {
      orgID: demoOrganization.id, id: "issue-2", number: 2, repository: "easyhaloo/agentforge",
      title: "Fix login redirect bug", body: "Users are being redirected to the wrong page after login.",
      state: "open", locked: false, comments: 3,
      labels: [{ id: "label-2", name: "bug", description: "Bug report", color: "d73a4a", created_at: now }],
      assignees: [{ user_id: "user-member" }],
      created_by: "user-member", created_at: "2026-11-16T09:00:00.000Z", updated_at: "2026-11-17T08:00:00.000Z",
    },
    {
      orgID: demoOrganization.id, id: "issue-3", number: 3, repository: "easyhaloo/agentforge",
      title: "Update documentation", body: "The API documentation needs to be updated with new endpoints.",
      state: "closed", state_reason: "completed", locked: false, comments: 2,
      labels: [{ id: "label-3", name: "documentation", description: "Documentation", color: "0075ca", created_at: now }],
      assignees: [],
      created_by: "user-owner", created_at: "2026-11-14T12:00:00.000Z", updated_at: "2026-11-15T16:00:00.000Z",
      closed_at: "2026-11-15T16:00:00.000Z", closed_by: "user-owner",
    },
    {
      orgID: demoOrganization.id, id: "issue-4", number: 4, repository: "easyhaloo/agentforge",
      title: "Improve performance", body: "Database queries are slow and need optimization.",
      state: "open", locked: false, comments: 8,
      labels: [
        { id: "label-1", name: "enhancement", description: "New feature", color: "a2eeef", created_at: now },
        { id: "label-4", name: "performance", description: "Performance improvement", color: "fbca04", created_at: now },
      ],
      assignees: [{ user_id: "user-owner" }, { user_id: "user-member" }],
      created_by: "user-member", created_at: "2026-11-10T08:00:00.000Z", updated_at: "2026-11-17T09:00:00.000Z",
    },
  ];

  // Track authentication state dynamically - changes after login/register
  let isAuthenticated = !signedOut;
  let currentUser = isAuthenticated
    ? { user_id: "user-owner", display_name: "Taylor Owner", email: "owner@example.test", organizations }
    : null;

  // Mock /auth/* endpoints
  await page.route("**/auth/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    // Helper to return JSON responses
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

    if (path === "/auth/providers" && method === "GET") return json({ providers: [] });

    // POST /auth/local/login
    if (path === "/auth/local/login" && method === "POST") {
      const body = request.postDataJSON() as { email: string; password: string };

      // Success scenario
      if (body.email === "test@example.com" && body.password === "password123") {
        const user = {
          user_id: "user-test-123",
          email: body.email,
          display_name: "Test User"
        };
        // Update authentication state after successful login
        isAuthenticated = true;
        currentUser = { ...user, organizations };
        return json(user, 200);
      }

      // Failure scenario - invalid credentials
      return json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Invalid email or password"
      }, 401);
    }

    // POST /auth/local/register
    if (path === "/auth/local/register" && method === "POST") {
      const body = request.postDataJSON() as {
        email: string;
        password: string;
        display_name: string
      };

      // Email already exists scenario
      if (body.email === "existing@example.com") {
        return json({
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "This email is already registered"
        }, 409);
      }

      // Success registration scenario
      const user = {
        user_id: "user-new-" + Date.now(),
        email: body.email,
        display_name: body.display_name
      };
      // Update authentication state after successful registration
      isAuthenticated = true;
      currentUser = { ...user, organizations };
      return json(user, 201);
    }

    return json({ title: "Unexpected test API request", detail: method + " " + path }, 404);
  });

  // Mock /api/v1/* endpoints
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (path === "/api/v1/me" && method === "GET") {
      if (!isAuthenticated || !currentUser) return json({ title: "Unauthorized", detail: "Authentication required" }, 401);
      return json(currentUser);
    }
    if (path === "/api/v1/auth/logout" && method === "POST") {
      isAuthenticated = false;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/issue-projects") && method === "GET") {
      return json({ items: [] });
    }
    if (path.endsWith("/repositories") && method === "GET") {
      return json({ items: repositories.filter(repo => path === `/api/v1/organizations/${repo.organization_id}/repositories`) });
    }
    if (path.endsWith("/repositories") && method === "POST") {
      const body = request.postDataJSON() as { slug: string; default_branch: string; visibility?: string; fork?: boolean };
      const added = {
        id: `repo-${repositories.length + 1}`, organization_id: path.split("/")[4], slug: body.slug, default_branch: body.default_branch,
        visibility: body.visibility, fork: body.fork ?? false,
        created_by: "user-owner", created_at: now, updated_at: now,
      };
      repositories = [...repositories, added];
      return json(added, 201);
    }
    if (path.startsWith("/api/v1/organizations/org-demo/repositories/easyhaloo/agentforge/") && method === "GET") {
      const repository = "easyhaloo/agentforge";
      const main = "a".repeat(40);
      const previous = "b".repeat(40);
      const ref = url.searchParams.get("ref");
      const commit_sha = ["refs/heads/release", "refs/tags/v0.1.0", previous].includes(ref ?? "") ? previous : main;
      if (path.endsWith("/refs")) return json({ repository, default_branch: "main", resolved_commit_sha: main, items: [
        { kind: "branch", name: "main", sha: main }, { kind: "branch", name: "release", sha: previous }, { kind: "tag", name: "v0.1.0", sha: previous },
      ] });
      if (path.endsWith("/tree")) return json({ repository, commit_sha, path: "", items: [{ name: "README.md", path: "README.md", kind: "file", mode: "100644", sha: previous, size: 12 }] });
      if (path.endsWith("/history")) {
        const latest = { sha: main, parents: [previous], author: "Test Author", authored_at: "2026-11-20T12:00:00Z", subject: "Latest commit" };
        const initial = { sha: previous, parents: [], author: "Initial Author", authored_at: "2026-11-17T12:00:00Z", subject: "Initial commit" };
        const items = commit_sha === previous ? [initial] : [latest, initial];
        return json({ repository, commit_sha, items: items.slice(0, Number(url.searchParams.get("limit") ?? 100)) });
      }
      if (path.endsWith("/compare")) {
        const base_sha = url.searchParams.get("base") ?? "";
        const head_sha = url.searchParams.get("head");
        const patch = base_sha
          ? "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-before\n+after\n"
          : "diff --git a/README.md b/README.md\n--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+before\n";
        return json({ repository, base_sha, head_sha, patch });
      }
      if (path.endsWith("/blob")) return json({ repository, commit_sha, blob_sha: previous, path: "README.md", encoding: "utf-8", content: "# Hello\n" });
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
    if (path === "/api/v1/auth/local/login" && method === "POST") {
      const body = request.postDataJSON() as { email: string; password: string };

      // Success scenario
      if (body.email === "test@example.com" && body.password === "password123") {
        const user = {
          user_id: "user-test",
          email: "test@example.com",
          display_name: "Test User"
        };
        // Update authentication state after successful login
        isAuthenticated = true;
        currentUser = { ...user, organizations };
        return json(user, 200);
      }

      // Failure scenario
      return json({
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "Invalid email or password"
      }, 401);
    }
    if (path === "/api/v1/auth/local/register" && method === "POST") {
      const body = request.postDataJSON() as {
        email: string;
        password: string;
        display_name: string
      };

      // Email already exists scenario
      if (body.email === "existing@example.com") {
        return json({
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "This email is already registered"
        }, 409);
      }

      // Success registration scenario
      const user = {
        user_id: "user-new-" + Date.now(),
        email: body.email,
        display_name: body.display_name
      };
      // Update authentication state after successful registration
      isAuthenticated = true;
      currentUser = { ...user, organizations };
      return json(user, 201);
    }
    // Issue tracking endpoints
    const issuePath = path.match(/^\/api\/v1\/organizations\/([^/]+)\/issues(?:\/(\d+)(\/[^/]+)?)?$/);
    if (issuePath && !currentUser?.organizations.some(org => org.id === issuePath[1])) {
      return json({ title: "Organization membership required", detail: path }, 401);
    }
    if (issuePath?.[2]) {
      const [, orgID, numberStr, action = ""] = issuePath;
      const number = Number(numberStr);
      const repository = url.searchParams.get("repository") ?? "";
      const issue = issues.find(item => item.orgID === orgID && item.number === number && item.repository === repository);

      if (!issue) return json({ title: "Issue not found", detail: "The issue does not exist" }, 404);

      if (method === "GET" && !action) return json(issueResponse(issue));

      if (method === "PATCH" && !action) {
        const body = request.postDataJSON() as { title?: string; body?: string; milestone_id?: string };
        Object.assign(issue, { ...body, updated_at: now });
        return json(issueResponse(issue));
      }

      if (method === "POST" && action === "/close") {
        const { reason } = request.postDataJSON() as { reason: MockIssue["state_reason"] };
        if (!reason || !["completed", "not_planned", "duplicate"].includes(reason)) {
          return json({ title: "Invalid close reason" }, 400);
        }
        issue.state = "closed";
        issue.state_reason = reason;
        issue.closed_at = now;
        issue.closed_by = currentUser?.user_id;
        issue.updated_at = now;
        return json(issueResponse(issue));
      }

      if (method === "POST" && action === "/reopen") {
        issue.state = "open";
        issue.state_reason = undefined;
        issue.closed_at = undefined;
        issue.closed_by = undefined;
        issue.updated_at = now;
        return json(issueResponse(issue));
      }

      // Fallback for unhandled methods on this endpoint
      return json({ title: "Method not allowed", detail: `${method} ${path}` }, 405);
    }

    if (issuePath && method === "GET") {
      const query = url.searchParams;
      const q = (query.get("q") ?? "").trim().toLowerCase();
      const repository = query.get("repository");
      const state = query.get("state");
      const creator = query.get("created_by");
      const assignee = query.get("assignee");
      const labels = query.get("labels");
      const milestone = query.get("milestone");
      const sort = query.get("sort") ?? "updated";
      const direction = query.get("direction") ?? "desc";
      const limit = Number(query.get("limit") ?? 20);
      const offset = Number(query.get("offset") ?? 0);
      const includeFilterOptions = query.get("include_filter_options") ?? "false";
      if (state && state !== "open" && state !== "closed") return json({ title: "Invalid state" }, 400);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
        return json({ title: "Invalid pagination" }, 400);
      }

      if (includeFilterOptions !== "true" && includeFilterOptions !== "false") {
        return json({ title: "Invalid include_filter_options" }, 400);
      }
      if (includeFilterOptions === "true" && !repository) return json({ title: "Repository required" }, 400);

      const number = /^#\d+$/.test(q) ? Number(q.slice(1)) : 0;
      const scope = issues.filter(item => item.orgID === issuePath[1] && (!repository || item.repository === repository));
      const unique = (values: string[]) => [...new Set(values)].sort();
      const filtered = scope.filter(item => {
        if (number > 0 ? item.number !== number : q && ![item.title, item.body].some(field => field.toLowerCase().includes(q))) return false;
        if (creator && item.created_by !== creator) return false;
        if (assignee && !item.assignees.some(a => a.user_id === assignee)) return false;
        if (labels && !item.labels.some(l => l.name === labels)) return false;
        return !milestone || item.milestone_id === milestone;
      });
      const matched = filtered.filter(item => !state || item.state === state);
      matched.sort((a, b) => {
        const comparison = sort === "comments" ? a.comments - b.comments
          : sort === "updated" ? a.updated_at.localeCompare(b.updated_at)
          : a.created_at.localeCompare(b.created_at);
        const order = comparison || a.number - b.number;
        return direction === "asc" ? order : -order;
      });
      return json({
        items: matched.slice(offset, offset + limit).map(issueResponse), total: matched.length, limit, offset,
        open_total: filtered.filter(item => item.state === "open").length,
        closed_total: filtered.filter(item => item.state === "closed").length,
        ...(includeFilterOptions === "true" && { filter_options: {
          authors: unique(scope.map(item => item.created_by)),
          labels: unique(scope.flatMap(item => item.labels.map(label => label.name))),
          assignees: unique(scope.flatMap(item => item.assignees.map(assignee => assignee.user_id))),
          milestones: unique(scope.flatMap(item => item.milestone_id ? [item.milestone_id] : [])),
        } }),
      });
    }

    if (issuePath && method === "POST") {
      const body = request.postDataJSON() as { repository: string; title: string; body: string };
      const scope = issues.filter(issue => issue.orgID === issuePath[1] && issue.repository === body.repository);
      const nextIssueNumber = Math.max(0, ...scope.map(issue => issue.number)) + 1;
      const newIssue: MockIssue = {
        id: `issue-${issuePath[1]}-${body.repository}-${nextIssueNumber}`,
        orgID: issuePath[1],
        number: nextIssueNumber,
        repository: body.repository,
        title: body.title,
        body: body.body,
        state: "open",
        locked: false,
        comments: 0,
        labels: [],
        assignees: [],
        created_by: currentUser!.user_id,
        created_at: now,
        updated_at: now,
      };
      issues = [newIssue, ...issues];
      return json(issueResponse(newIssue), 201);
    }

    return json({ title: "Unexpected test API request", detail: method + " " + path }, 404);
  });
}
