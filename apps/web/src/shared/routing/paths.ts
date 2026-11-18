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
  repositories: "/repositories",
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
export type OrgSection = "changesets" | "trails" | "review" | "eval" | "settings";

export function orgPath(handle: string, section: OrgSection): string {
  return `/orgs/${encodeURIComponent(handle)}/${section}`;
}

/**
 * Same sub-path under another organization; paths outside `/orgs/:org` are returned unchanged. The router matches
 * static segments case-insensitively, so `/ORGS/a/...` is an organization path too; the prefix is emitted as `/orgs`.
 */
export function withOrganizationHandle(pathname: string, handle: string): string {
  return pathname.replace(/^\/orgs\/[^/]+/i, `/orgs/${encodeURIComponent(handle)}`);
}
