import { Activity, ArrowDownUp, Boxes, BrainCircuit, CheckCircle2, Code2, GitBranch, GitCommitHorizontal, GitPullRequest, LayoutDashboard, LockKeyhole, PanelsTopLeft, Settings, ShieldCheck, Terminal, Workflow, Zap, Users, type LucideIcon } from "lucide-react";
import { flatPaths, orgPath, type OrgSection } from "../shared/routing";

/**
 * Single data source for the sidebar, the command palette, the page header and the breadcrumb.
 * Mock pages carry a flat `path`; pages backed by the real API carry an `orgPath` that is
 * completed with an organization handle (see shared/routing).
 */
export type NavigationItem = {
  label: string;
  description: string;
  icon: LucideIcon;
  group: string;
} & ({ path: string } | { orgPath: (handle: string) => string });

const inOrganization = (section: OrgSection) => (handle: string) => orgPath(handle, section);

export const navigationItems: readonly NavigationItem[] = [
  { group: "WORKSPACE", label: "Overview", icon: LayoutDashboard, description: "A live map of changes, verification and delivery across your engineering system.", path: flatPaths.overview },
  { group: "WORKSPACE", label: "Projects", icon: Boxes, description: "Organize repositories, teams and delivery boundaries.", path: flatPaths.projects },
  { group: "WORKSPACE", label: "Repositories", icon: Code2, description: "Git-compatible repositories backed by a canonical object graph.", orgPath: inOrganization("repositories") },
  { group: "WORKSPACE", label: "Changesets", icon: GitCommitHorizontal, description: "Reviewable, revisioned units of change — distinct from Git commits.", orgPath: inOrganization("changesets") },
  { group: "WORKSPACE", label: "Workspaces", icon: Terminal, description: "Isolated environments for agents and human contributors.", path: flatPaths.workspaces },
  { group: "COORDINATION", label: "Trails", icon: Workflow, description: "Cross-repository delivery goals with traceable evidence.", orgPath: inOrganization("trails") },
  { group: "COORDINATION", label: "Stacks", icon: GitBranch, description: "Compose dependent changesets into a navigable change graph.", path: flatPaths.stacks },
  { group: "COORDINATION", label: "Review", icon: GitPullRequest, description: "Human decisions grounded in revision-specific evidence.", orgPath: inOrganization("review") },
  { group: "COORDINATION", label: "Eval", icon: CheckCircle2, description: "Evaluate changes against quality, policy and product expectations.", orgPath: inOrganization("eval") },
  { group: "COORDINATION", label: "Self-healing", icon: Activity, description: "Bounded repair loops that produce new revisions and re-run validation.", path: flatPaths.selfHealing },
  { group: "INTELLIGENCE", label: "Memory", icon: BrainCircuit, description: "Reusable engineering knowledge linked to sessions, code and decisions.", path: flatPaths.memory },
  { group: "INTELLIGENCE", label: "CI / CD", icon: Zap, description: "Pipelines, checks and release orchestration.", orgPath: inOrganization("pipelines") },
  { group: "DEVELOPER", label: "WebIDE", icon: Code2, description: "Open repository files in a commit-pinned, read-only editor workspace.", orgPath: inOrganization("webide") },
  { group: "DEVELOPER", label: "UI Components", icon: PanelsTopLeft, description: "Explore the shared component system, interaction patterns and design tokens.", path: flatPaths.uiComponents },
  { group: "CONTROL PLANE", label: "Organization", icon: Users, description: "Manage organization members, invitations, roles and access history.", orgPath: inOrganization("settings") },
  { group: "CONTROL PLANE", label: "Security", icon: ShieldCheck, description: "Identity, secrets, supply-chain and runtime boundaries.", path: flatPaths.security },
  { group: "CONTROL PLANE", label: "Governance", icon: LockKeyhole, description: "Policies, approvals and organization-wide controls.", path: flatPaths.governance },
  { group: "CONTROL PLANE", label: "Cost & Usage", icon: ArrowDownUp, description: "Understand agent, model and compute consumption.", path: flatPaths.usage },
  { group: "CONTROL PLANE", label: "Settings", icon: Settings, description: "Configure your organization and developer experience.", path: flatPaths.settings },
];

/** Sidebar sections, in order of first appearance in `navigationItems`. */
export const navigationGroups = [...new Set(navigationItems.map((item) => item.group))]
  .map((label) => ({ label, items: navigationItems.filter((item) => item.group === label) }));

/** The URL of an item; `handle` only matters for organization-scoped items. */
export function itemHref(item: NavigationItem, handle: string): string {
  return "orgPath" in item ? item.orgPath(handle) : item.path;
}

/** Every leaf route in app/routes.tsx declares `handle: { label }`; the root layout reads it with useMatches(). */
export type RouteHandle = { label: string };

export function routeLabel(handle: unknown): string {
  return typeof handle === "object" && handle !== null && "label" in handle && typeof handle.label === "string" ? handle.label : "";
}

/** The item for the page being shown; pages that are not in the sidebar (not found) have none. */
export const navigationItemFor = (label: string) => navigationItems.find((item) => item.label === label);
