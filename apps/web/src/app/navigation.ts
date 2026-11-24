import { Activity, Bell, ArrowDownUp, Boxes, BrainCircuit, CheckCircle2, Code2, CircleDot, GitBranch, GitCommitHorizontal, GitPullRequest, LayoutDashboard, LockKeyhole, PanelsTopLeft, Settings, ShieldCheck, Terminal, Workflow, Zap, Users, type LucideIcon } from "lucide-react";
import { flatPaths, orgPath, repositorySections, type OrgSection } from "../shared/routing";

/**
 * Shared page metadata for the sidebar, the command palette, the page header and the breadcrumb.
 * Mock pages carry a flat `path`; pages backed by the real API carry an `orgPath` that is
 * completed with an organization handle (see shared/routing).
 */
export type NavigationItem = {
  label: string;
  descriptionKey?: string;
  icon: LucideIcon;
  group: string;
} & ({ path: string } | { orgPath: (handle: string) => string });

const inOrganization = (section: OrgSection) => (handle: string) => orgPath(handle, section);

export const navigationItems: readonly NavigationItem[] = [
  { group: "WORKSPACE", label: "Overview", icon: LayoutDashboard, descriptionKey: "navigation:descriptions.overview", path: flatPaths.overview },
  { group: "WORKSPACE", label: "Projects", icon: Boxes, path: flatPaths.projects },
  { group: "WORKSPACE", label: "Repositories", icon: Code2, descriptionKey: "navigation:descriptions.repositories", orgPath: inOrganization("repositories") },
  { group: "WORKSPACE", label: "Issues", icon: CircleDot, descriptionKey: "navigation:descriptions.issues", orgPath: inOrganization("issues") },
  { group: "WORKSPACE", label: "Inbox", icon: Bell, descriptionKey: "navigation:descriptions.inbox", orgPath: inOrganization("notifications") },
  { group: "WORKSPACE", label: "Changesets", icon: GitCommitHorizontal, descriptionKey: "navigation:descriptions.changesets", orgPath: inOrganization("changesets") },
  { group: "WORKSPACE", label: "Workspaces", icon: Terminal, descriptionKey: "navigation:descriptions.workspaces", path: flatPaths.workspaces },
  { group: "COORDINATION", label: "Trails", icon: Workflow, descriptionKey: "navigation:descriptions.trails", orgPath: inOrganization("trails") },
  { group: "COORDINATION", label: "Review", icon: GitPullRequest, descriptionKey: "navigation:descriptions.review", orgPath: inOrganization("review") },
  { group: "COORDINATION", label: "Eval", icon: CheckCircle2, descriptionKey: "navigation:descriptions.eval", orgPath: inOrganization("eval") },
  { group: "COORDINATION", label: "Self-healing", icon: Activity, descriptionKey: "navigation:descriptions.selfHealing", path: flatPaths.selfHealing },
  { group: "INTELLIGENCE", label: "Memory", icon: BrainCircuit, descriptionKey: "navigation:descriptions.memory", path: flatPaths.memory },
  { group: "INTELLIGENCE", label: "CI / CD", icon: Zap, descriptionKey: "navigation:descriptions.cicd", orgPath: inOrganization("pipelines") },
  { group: "DEVELOPER", label: "WebIDE", icon: Code2, descriptionKey: "navigation:descriptions.webide", orgPath: inOrganization("webide") },
  { group: "DEVELOPER", label: "UI Components", icon: PanelsTopLeft, descriptionKey: "navigation:descriptions.uiComponents", path: flatPaths.uiComponents },
  { group: "CONTROL PLANE", label: "Organization", icon: Users, descriptionKey: "navigation:descriptions.organization", orgPath: inOrganization("settings") },
  { group: "CONTROL PLANE", label: "Security", icon: ShieldCheck, descriptionKey: "navigation:descriptions.security", path: flatPaths.security },
  { group: "CONTROL PLANE", label: "Governance", icon: LockKeyhole, descriptionKey: "navigation:descriptions.governance", path: flatPaths.governance },
  { group: "CONTROL PLANE", label: "Cost & Usage", icon: ArrowDownUp, descriptionKey: "navigation:descriptions.usage", path: flatPaths.usage },
  { group: "CONTROL PLANE", label: "Settings", icon: Settings, descriptionKey: "navigation:descriptions.settings", path: flatPaths.settings },
];

/** Sidebar sections, with settings links reserved for the user menu. */
const sidebarItems = navigationItems.filter((item) => item.label !== "Organization" && item.label !== "Settings");
export const navigationGroups = [...new Set(sidebarItems.map((item) => item.group))]
  .map((label) => ({ label, items: sidebarItems.filter((item) => item.group === label) }));

/** The URL of an item; `handle` only matters for organization-scoped items. */
export function itemHref(item: NavigationItem, handle: string): string {
  return "orgPath" in item ? item.orgPath(handle) : item.path;
}

/** Repository subpages, including source-control settings such as Rulesets, activate their owning top-level tab. */
export function repositorySectionForPath(pathname: string | undefined) {
  const segment = pathname?.split("/")[6]?.toLowerCase();
  return repositorySections.find(section => section === segment);
}

/** Every leaf route in app/routes.tsx declares `handle: { label }`; the root layout reads it with useMatches(). */
export type RouteHandle = { label: string };

export function routeLabel(handle: unknown): string {
  return typeof handle === "object" && handle !== null && "label" in handle && typeof handle.label === "string" ? handle.label : "";
}

/** The item for the page being shown; pages that are not in the sidebar (not found) have none. */
export const navigationItemFor = (label: string) => navigationItems.find((item) => item.label === label);
