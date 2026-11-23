/**
 * URL construction for the client router. Pure functions only: pages build links through here
 * (they must not import `app`), and `app/routes.tsx` declares the matching route patterns.
 * `/api/*` and `/auth/*` are backend paths on the same origin and are never client routes.
 */

/** Client-side alias for "the selected organization"; replaced by the canonical handle once known. */
export const CURRENT_ORGANIZATION_HANDLE = "current";

/** Mock/fixture pages are not organization-scoped. */
export const flatPaths = {
  overview: "/",
  projects: "/projects", // Compatibility entry for links without organization context.
  workspaces: "/workspaces",
  selfHealing: "/self-healing",
  memory: "/memory",
  security: "/security",
  governance: "/governance",
  usage: "/usage",
  settings: "/settings",
  uiComponents: "/dev/ui",
} as const;

/** Pages backed by the real API live under `/orgs/:org/<section>`. `settings` is the Organization page. */
export type OrgSection = "pipelines" | "changesets" | "projects" | "issues" | "notifications" | "repositories" | "webide" | "trails" | "review" | "eval" | "settings";

export function orgPath(handle: string, section: OrgSection): string {
  return `/orgs/${encodeURIComponent(handle)}/${section}`;
}

export function projectPath(handle: string, number: string | number): string {
  return `${orgPath(handle, "projects")}/${encodeURIComponent(number)}`;
}

export const repositorySections = ["issues", "pulls", "actions", "settings"] as const;
export type RepositorySection = typeof repositorySections[number];

export function repositoryPath(handle: string, slug: string, section?: RepositorySection): string {
  const base = `${orgPath(handle, "repositories")}/${slug.split("/").map(encodeURIComponent).join("/")}`;
  return section ? `${base}/${section}` : base;
}

export const repositorySettingsSections = ["general", "rulesets", "branches", "tags", "git-tokens", "actions", "webhooks"] as const;
export type RepositorySettingsSection = typeof repositorySettingsSections[number];

export function repositorySettingsPath(handle: string, slug: string, section: RepositorySettingsSection = "general"): string {
  const base = repositoryPath(handle, slug, "settings");
  return section === "general" ? base : `${base}/${section}`;
}

export function repositoryNewPath(handle: string): string {
  return `${orgPath(handle, "repositories")}/new`;
}

/** Pull request tabs match the GitHub pattern: Conversation, Commits, Checks, Files changed. */
export const pullRequestTabs = ["conversation", "commits", "checks", "files"] as const;
export type PullRequestTab = typeof pullRequestTabs[number];

export function pullRequestPath(handle: string, slug: string, pullNumber: string | number, tab?: PullRequestTab): string {
  const base = `${repositoryPath(handle, slug, "pulls")}/${encodeURIComponent(pullNumber)}`;
  return tab && tab !== "conversation" ? `${base}/${tab}` : base;
}

export function pullRequestComparePath(handle: string, slug: string): string {
  return `${repositoryPath(handle, slug, "pulls")}/new`;
}

export function issueDetailPath(handle: string, slug: string, issueNumber: number): string {
  return `${repositoryPath(handle, slug, "issues")}/${issueNumber}`;
}

export function issueCreatePath(handle: string, slug: string): string {
  return `${repositoryPath(handle, slug, "issues")}/new`;
}

export function issueTemplatePath(handle: string, slug: string): string {
  return `${issueCreatePath(handle, slug)}/choose`;
}

export function repositoryChangesetsPath(handle: string, repository: string, options: { source?: string; create?: string } = {}): string {
  return `${orgPath(handle, "changesets")}?${new URLSearchParams({ repository, scope: "repository", ...options })}`;
}

/** The parts of a changeset. Each one is a route, so every step of the lifecycle is linkable. */
export const changesetTabs = ["overview", "revisions", "evaluation", "review", "merge"] as const;
export type ChangesetTab = typeof changesetTabs[number];

/** The changeset detail page; the overview is the page itself, the other parts are a suffix. */
export function changesetPath(handle: string, changesetID: string, tab: ChangesetTab = "overview"): string {
  const base = `${orgPath(handle, "changesets")}/${encodeURIComponent(changesetID)}`;
  return tab === "overview" ? base : `${base}/${tab}`;
}

export function pipelineRunPath(handle: string, runId: string): string {
  return `/orgs/${encodeURIComponent(handle)}/pipeline-runs/${encodeURIComponent(runId)}`;
}

export function pipelineEditPath(handle: string, id: string): string {
  return `${orgPath(handle, "pipelines")}/${encodeURIComponent(id)}/edit`;
}

/**
 * Same sub-path under another organization; paths outside `/orgs/:org` are returned unchanged. The router matches
 * static segments case-insensitively, so `/ORGS/a/...` is an organization path too; the prefix is emitted as `/orgs`.
 */
export function withOrganizationHandle(pathname: string, handle: string): string {
  return pathname.replace(/^\/orgs\/[^/]+/i, `/orgs/${encodeURIComponent(handle)}`);
}

/**
 * Build a WebIDE URL with query parameters for repository, commit, and optional changeset/path/line.
 */
export function webIDEPath(handle: string, params: {
  repository: string;
  commit?: string;
  changeset?: string;
  path?: string;
  line?: number;
}): string {
  const base = orgPath(handle, "webide");
  const query = new URLSearchParams();
  query.set("repository", params.repository);
  if (params.commit) query.set("commit", params.commit);
  if (params.changeset) query.set("changeset", params.changeset);
  if (params.path) query.set("path", params.path);
  if (params.line) query.set("line", String(params.line));
  return `${base}?${query.toString()}`;
}

/** Only allow local paths as post-authentication destinations. */
export function authReturnPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return undefined;
  return value;
}

export const repositoryActionFilters = ["workflow", "status", "event", "q", "offset", "branch", "actor"] as const;

export function repositoryActionsContext(repository: string, filters?: URLSearchParams): string {
  const query = new URLSearchParams({ fromRepository: repository });
  for (const key of repositoryActionFilters) {
    const value = filters?.get(key);
    if (value) query.set(key, value);
  }
  return `?${query}`;
}

export function repositoryActionsBackPath(handle: string, query: URLSearchParams): string | undefined {
  const repository = query.get("fromRepository");
  if (!repository || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository) ||
    repository.split("/").some(part => part === "." || part === "..")) return undefined;
  const filters = new URLSearchParams();
  for (const key of repositoryActionFilters) {
    const value = query.get(key);
    if (value) filters.set(key, value);
  }
  const path = repositoryPath(handle, repository, "actions");
  return filters.size ? `${path}?${filters}` : path;
}
