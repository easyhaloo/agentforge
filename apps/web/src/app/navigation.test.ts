import { describe, expect, it } from "vitest";
import en from "../locales/en-US/navigation.json";
import zh from "../locales/zh-CN/navigation.json";
import { groupToNavKey, labelToNavKey } from "./navigation-labels";
import { itemHref, navigationGroups, navigationItems } from "./navigation";

// Deliberately independent of the code under test so changes in copy or order fail here.
const expectedGroups = [
  { label: "WORKSPACE", items: ["Overview", "Projects", "Repositories", "Issues", "Changesets", "Workspaces"] },
  { label: "COORDINATION", items: ["Trails", "Review", "Eval", "Self-healing"] },
  { label: "INTELLIGENCE", items: ["Memory", "CI / CD"] },
  { label: "DEVELOPER", items: ["WebIDE", "UI Components"] },
  { label: "CONTROL PLANE", items: ["Security", "Governance", "Cost & Usage"] },
];


describe("navigation data source", () => {
  it.each([en, zh])("translates every sidebar entry", (locale) => {
    for (const group of navigationGroups) {
      expect({ navigation: locale }).toHaveProperty(groupToNavKey(group.label).replace(":", "."));
      for (const item of group.items) expect({ navigation: locale }).toHaveProperty(labelToNavKey(item.label).replace(":", "."));
    }
  });

  it("keeps the group labels, item labels and their order", () => {
    expect(navigationGroups.map((group) => ({ label: group.label, items: group.items.map((item) => item.label) }))).toEqual(expectedGroups);
  });

  it("points every item at a description key instead of a hardcoded sentence", () => {
    // The English wording lives in the locale files now, so the description is a key the
    // `architecture/i18n-keys.test.ts` check resolves in every shipped language.
    for (const item of navigationItems) {
      expect(item.descriptionKey, item.label).toMatch(/^navigation:descriptions\./);
    }
  });

  it("tags every item with the group it is listed under", () => {
    for (const group of expectedGroups) {
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
      Repositories: "/orgs/demo/repositories",
      Issues: "/orgs/demo/issues",
      Changesets: "/orgs/demo/changesets",
      Workspaces: "/workspaces",
      Trails: "/orgs/demo/trails",
      Review: "/orgs/demo/review",
      Eval: "/orgs/demo/eval",
      "Self-healing": "/self-healing",
      Memory: "/memory",
      "CI / CD": "/orgs/demo/pipelines",
      WebIDE: "/orgs/demo/webide",
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
