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
  projects: "/projects",
  workspaces: "/workspaces",
  stacks: "/stacks",
  selfHealing: "/self-healing",
  memory: "/memory",
  pipelines: "/pipelines",
  security: "/security",
  governance: "/governance",
  usage: "/usage",
  settings: "/settings",
  uiComponents: "/dev/ui",
} as const;

/** Pages backed by the real API live under `/orgs/:org/<section>`. `settings` is the Organization page. */
export type OrgSection = "changesets" | "repositories" | "trails" | "review" | "eval" | "settings";

export function orgPath(handle: string, section: OrgSection): string {
  return `/orgs/${encodeURIComponent(handle)}/${section}`;
}

/** The parts of a changeset. Each one is a route, so every step of the lifecycle is linkable. */
export const changesetTabs = ["overview", "revisions", "evaluation", "review", "merge"] as const;
export type ChangesetTab = typeof changesetTabs[number];

/** The changeset detail page; the overview is the page itself, the other parts are a suffix. */
export function changesetPath(handle: string, changesetID: string, tab: ChangesetTab = "overview"): string {
  const base = `${orgPath(handle, "changesets")}/${encodeURIComponent(changesetID)}`;
  return tab === "overview" ? base : `${base}/${tab}`;
}

/**
 * Same sub-path under another organization; paths outside `/orgs/:org` are returned unchanged. The router matches
 * static segments case-insensitively, so `/ORGS/a/...` is an organization path too; the prefix is emitted as `/orgs`.
 */
export function withOrganizationHandle(pathname: string, handle: string): string {
  return pathname.replace(/^\/orgs\/[^/]+/i, `/orgs/${encodeURIComponent(handle)}`);
}
