import { Activity, Bell, ArrowDownUp, Boxes, BrainCircuit, CheckCircle2, Code2, CircleDot, GitBranch, GitCommitHorizontal, GitPullRequest, LayoutDashboard, LockKeyhole, PanelsTopLeft, Settings, ShieldCheck, Terminal, Workflow, Zap, Users, type LucideIcon } from "lucide-react";
import { flatPaths, orgPath, repositorySections, type OrgSection } from "../shared/routing";

/**
 * Shared page metadata for the sidebar, the command palette and the Topbar.
 * Mock pages carry a flat `path`; pages backed by the real API carry an `orgPath` that is
 * completed with an organization handle (see shared/routing).
 */
export type NavigationItem = {
  label: string;
  icon: LucideIcon;
  group: string;
} & ({ path: string } | { orgPath: (handle: string) => string });

const inOrganization = (section: OrgSection) => (handle: string) => orgPath(handle, section);

export const navigationItems: readonly NavigationItem[] = [
  { group: "WORKSPACE", label: "Overview", icon: LayoutDashboard, path: flatPaths.overview },
  { group: "WORKSPACE", label: "Projects", icon: Boxes, orgPath: inOrganization("projects") },
  { group: "WORKSPACE", label: "Repositories", icon: Code2, orgPath: inOrganization("repositories") },
  { group: "WORKSPACE", label: "Issues", icon: CircleDot, orgPath: inOrganization("issues") },
  { group: "WORKSPACE", label: "Inbox", icon: Bell, orgPath: inOrganization("notifications") },
  { group: "WORKSPACE", label: "Changesets", icon: GitCommitHorizontal, orgPath: inOrganization("changesets") },
  { group: "WORKSPACE", label: "Workspaces", icon: Terminal, path: flatPaths.workspaces },
  { group: "COORDINATION", label: "Trails", icon: Workflow, orgPath: inOrganization("trails") },
  { group: "COORDINATION", label: "Review", icon: GitPullRequest, orgPath: inOrganization("review") },
  { group: "COORDINATION", label: "Eval", icon: CheckCircle2, orgPath: inOrganization("eval") },
  { group: "COORDINATION", label: "Self-healing", icon: Activity, path: flatPaths.selfHealing },
  { group: "INTELLIGENCE", label: "Memory", icon: BrainCircuit, path: flatPaths.memory },
  { group: "INTELLIGENCE", label: "CI / CD", icon: Zap, orgPath: inOrganization("pipelines") },
  { group: "DEVELOPER", label: "WebIDE", icon: Code2, orgPath: inOrganization("webide") },
  { group: "DEVELOPER", label: "UI Components", icon: PanelsTopLeft, path: flatPaths.uiComponents },
  { group: "CONTROL PLANE", label: "Organization", icon: Users, orgPath: inOrganization("settings") },
  { group: "CONTROL PLANE", label: "Security", icon: ShieldCheck, path: flatPaths.security },
  { group: "CONTROL PLANE", label: "Governance", icon: LockKeyhole, path: flatPaths.governance },
  { group: "CONTROL PLANE", label: "Cost & Usage", icon: ArrowDownUp, path: flatPaths.usage },
  { group: "CONTROL PLANE", label: "Settings", icon: Settings, path: flatPaths.settings },
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
  const segment = pathname?.match(/^\/orgs\/[^/]+\/repositories\/[^/]+\/[^/]+\/([^/]+)/i)?.[1].toLowerCase();
  return repositorySections.find(section => section === segment);
}

/** Every leaf route in app/routes.tsx declares `handle: { label }`; the root layout reads it with useMatches(). */
export type RouteHandle = { label: string };

export function routeLabel(handle: unknown): string {
  return typeof handle === "object" && handle !== null && "label" in handle && typeof handle.label === "string" ? handle.label : "";
}

/** The item for the page being shown; pages that are not in the sidebar (not found) have none. */
export const navigationItemFor = (label: string) => navigationItems.find((item) => item.label === label);
