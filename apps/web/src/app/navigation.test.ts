import { describe, expect, it } from "vitest";
import { itemHref, navigationGroups, navigationItems } from "./navigation";

// Pre-refactor values, copied as literals from the old navigation.ts (`groups` and `descriptions`).
// They are deliberately not derived from the code under test, so any drift in copy or order fails here.
const legacyGroups = [
  { label: "WORKSPACE", items: ["Overview", "Projects", "Repositories", "Changesets", "Workspaces"] },
  { label: "COORDINATION", items: ["Trails", "Stacks", "Review", "Eval", "Self-healing"] },
  { label: "INTELLIGENCE", items: ["Memory", "CI / CD"] },
  { label: "DEVELOPER", items: ["UI Components"] },
  { label: "CONTROL PLANE", items: ["Organization", "Security", "Governance", "Cost & Usage", "Settings"] },
];
const legacyDescriptions: Record<string, string> = {
  Overview: "A live map of changes, verification and delivery across your engineering system.",
  Projects: "Organize repositories, teams and delivery boundaries.",
  Repositories: "Git-compatible repositories backed by a canonical object graph.",
  Changesets: "Reviewable, revisioned units of change — distinct from Git commits.",
  Workspaces: "Isolated environments for agents and human contributors.",
  Trails: "Cross-repository delivery goals with traceable evidence.",
  Stacks: "Compose dependent changesets into a navigable change graph.",
  Review: "Human decisions grounded in revision-specific evidence.",
  Eval: "Evaluate changes against quality, policy and product expectations.",
  "Self-healing": "Bounded repair loops that produce new revisions and re-run validation.",
  Memory: "Reusable engineering knowledge linked to sessions, code and decisions.",
  "CI / CD": "Pipelines, checks and release orchestration.",
  Organization: "Manage organization members, invitations, roles and access history.",
  Security: "Identity, secrets, supply-chain and runtime boundaries.",
  Governance: "Policies, approvals and organization-wide controls.",
  "Cost & Usage": "Understand agent, model and compute consumption.",
  Settings: "Configure your organization and developer experience.",
  "UI Components": "Explore the shared component system, interaction patterns and design tokens.",
};

describe("navigation data source", () => {
  it("keeps the group labels, item labels and their order", () => {
    expect(navigationGroups.map((group) => ({ label: group.label, items: group.items.map((item) => item.label) }))).toEqual(legacyGroups);
  });

  it("keeps every description byte for byte", () => {
    expect(Object.fromEntries(navigationItems.map((item) => [item.label, item.description]))).toEqual(legacyDescriptions);
  });

  it("tags every item with the group it is listed under", () => {
    for (const group of legacyGroups) {
      for (const label of group.items) {
        expect(navigationItems.find((item) => item.label === label)?.group).toBe(group.label);
      }
    }
  });

  it("gives every item an icon", () => {
    for (const item of navigationItems) expect(item.icon, item.label).toBeTruthy();
  });

  it("links each item to its documented URL, scoping only the live pages to the organization", () => {
    expect(Object.fromEntries(navigationItems.map((item) => [item.label, itemHref(item, "demo")]))).toEqual({
      Overview: "/",
      Projects: "/projects",
      Repositories: "/repositories",
      Changesets: "/orgs/demo/changesets",
      Workspaces: "/workspaces",
      Trails: "/orgs/demo/trails",
      Stacks: "/stacks",
      Review: "/orgs/demo/review",
      Eval: "/orgs/demo/eval",
      "Self-healing": "/self-healing",
      Memory: "/memory",
      "CI / CD": "/pipelines",
      "UI Components": "/dev/ui",
      Organization: "/orgs/demo/settings",
      Security: "/security",
      Governance: "/governance",
      "Cost & Usage": "/usage",
      Settings: "/settings",
    });
  });

  it("builds organization-scoped links from whatever handle it is given, including the current alias", () => {
    const changesets = navigationItems.find((item) => item.label === "Changesets")!;
    expect(itemHref(changesets, "current")).toBe("/orgs/current/changesets");
    expect(itemHref(changesets, "a b")).toBe("/orgs/a%20b/changesets");
    const projects = navigationItems.find((item) => item.label === "Projects")!;
    expect(itemHref(projects, "anything")).toBe("/projects");
  });
});
