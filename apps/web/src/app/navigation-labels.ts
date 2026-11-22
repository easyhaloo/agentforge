/**
 * The translation keys behind the navigation labels and groups.
 *
 * The sidebar, the topbar, the page header and the command palette all render the same
 * navigation, so they share one map: a label missing from it would surface as an untranslated
 * key in four places at once. `architecture/i18n-keys.test.ts` checks every label in
 * `navigation.ts` and every route label in `routes.tsx` against this map.
 */

/** Navigation item labels to their `navigation` namespace keys. */
export const routeKeyByLabel: Record<string, string> = {
  "Overview": "navigation:routes.overview",
  "Projects": "navigation:routes.projects",
  "Repositories": "navigation:routes.repositories",
  "Repository": "navigation:routes.repository",
  "Issues": "navigation:routes.issues",
  "Issue": "navigation:routes.issue",
  "Pull requests": "navigation:routes.pullRequests",
  "Compare and create pull request": "navigation:routes.comparePullRequest",
  "Pull request": "navigation:routes.pullRequest",
  "Changesets": "navigation:routes.changesets",
  "Changeset": "navigation:routes.changeset",
  "Workspaces": "navigation:routes.workspaces",
  "Trails": "navigation:routes.trails",
  "Review": "navigation:routes.review",
  "Eval": "navigation:routes.eval",
  "Self-healing": "navigation:routes.selfHealing",
  "Memory": "navigation:routes.memory",
  "CI / CD": "navigation:routes.cicd",
  "WebIDE": "navigation:routes.webide",
  "UI Components": "navigation:routes.uiComponents",
  "Organization": "navigation:routes.organization",
  "Security": "navigation:routes.security",
  "Governance": "navigation:routes.governance",
  "Cost & Usage": "navigation:routes.usage",
  "Settings": "navigation:routes.settings",
  "Page not found": "navigation:routes.notFound",
};

/** Navigation group names to their `navigation` namespace keys. */
export const groupKeyByGroup: Record<string, string> = {
  "WORKSPACE": "navigation:groups.WORKSPACE",
  "COORDINATION": "navigation:groups.COORDINATION",
  "INTELLIGENCE": "navigation:groups.INTELLIGENCE",
  "DEVELOPER": "navigation:groups.DEVELOPER",
  "CONTROL PLANE": "navigation:groups.CONTROL PLANE",
};

/** The translation key for a navigation item label. Unknown labels fall back to themselves. */
export function labelToNavKey(label: string): string {
  return routeKeyByLabel[label] ?? label;
}

/** The translation key for a navigation group name. Unknown groups fall back to a derived key. */
export function groupToNavKey(group: string): string {
  return groupKeyByGroup[group] ?? `navigation:groups.${group}`;
}
