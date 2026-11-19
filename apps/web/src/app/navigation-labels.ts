/**
 * Maps navigation labels to i18n keys.
 * This ensures the sidebar and other navigation components reference the correct translation keys.
 */

const labelToRouteKey: Record<string, string> = {
  "Overview": "overview",
  "Projects": "projects",
  "Repositories": "repositories",
  "Changesets": "changesets",
  "Workspaces": "workspaces",
  "Trails": "trails",
  "Stacks": "stacks",
  "Review": "review",
  "Eval": "eval",
  "Self-healing": "selfHealing",
  "Memory": "memory",
  "CI / CD": "cicd",
  "WebIDE": "webide",
  "UI Components": "uiComponents",
  "Organization": "organization",
  "Security": "security",
  "Governance": "governance",
  "Cost & Usage": "usage",
  "Settings": "settings",
};

/**
 * Convert a navigation group label to its i18n key.
 * Example: "WORKSPACE" → "groups.WORKSPACE"
 */
export function groupToNavKey(groupLabel: string): string {
  return `groups.${groupLabel}`;
}

/**
 * Convert a navigation item label to its i18n key.
 * Example: "Overview" → "routes.overview"
 */
export function labelToNavKey(itemLabel: string): string {
  const routeKey = labelToRouteKey[itemLabel];
  if (!routeKey) {
    console.warn(`Missing route key mapping for label: "${itemLabel}"`);
    return `routes.${itemLabel.toLowerCase()}`;
  }
  return `routes.${routeKey}`;
}
