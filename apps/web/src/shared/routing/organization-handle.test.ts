import { describe, expect, it } from "vitest";
import type { OrganizationSummary } from "../api/identity";
import { findOrganizationByHandle, organizationHandle, ownerDisplayLabel, repositoryDisplaySlug } from "./organization-handle";
import { CURRENT_ORGANIZATION_HANDLE } from "./paths";

const org = (id: string, slug: string): OrganizationSummary => ({ id, slug, name: `Org ${id}`, role: "owner" });
// The API may not return `slug` yet (frontend and backend deploy independently).
const legacyOrg = { id: "org-legacy", name: "Legacy", role: "owner" } as OrganizationSummary;

describe("organizationHandle", () => {
  it("uses the slug when there is one", () => {
    expect(organizationHandle(org("org-demo", "demo"))).toBe("demo");
  });

  it("falls back to the id when the slug is empty or missing", () => {
    expect(organizationHandle(org("org-demo", ""))).toBe("org-demo");
    expect(organizationHandle(legacyOrg)).toBe("org-legacy");
  });

  it("never returns the reserved current alias, so such an organization is addressed by its id", () => {
    expect(organizationHandle(org("org-demo", "current"))).toBe("org-demo");
    expect(organizationHandle(org("org-demo", "Current"))).toBe("org-demo");
  });
});

describe("ownerDisplayLabel", () => {
  it("shows the organization name when the owner prefix is the org id", () => {
    expect(ownerDisplayLabel("org-1", { id: "org-1", name: "AgentForge Local's Workspace" })).toBe("AgentForge Local's Workspace");
  });

  it("shows the owner as-is when it is not the org id", () => {
    expect(ownerDisplayLabel("other/testing", { id: "org-1", name: "Workspace" })).toBe("other/testing");
  });
});

describe("repositoryDisplaySlug", () => {
  it("replaces the org-id owner prefix with the display name", () => {
    expect(repositoryDisplaySlug("org-1/testing", { id: "org-1", name: "Workspace" })).toBe("Workspace/testing");
  });

  it("keeps slugs without an owner prefix unchanged", () => {
    expect(repositoryDisplaySlug("testing", { id: "org-1", name: "Workspace" })).toBe("testing");
  });
});

describe("findOrganizationByHandle", () => {
  const organizations = [org("org-a", "alpha"), org("org-b", "Beta"), legacyOrg];

  it("matches an id exactly", () => {
    expect(findOrganizationByHandle(organizations, "org-b")?.id).toBe("org-b");
    expect(findOrganizationByHandle(organizations, "ORG-B")).toBeUndefined();
  });

  it("matches a slug case-insensitively", () => {
    expect(findOrganizationByHandle(organizations, "alpha")?.id).toBe("org-a");
    expect(findOrganizationByHandle(organizations, "ALPHA")?.id).toBe("org-a");
    expect(findOrganizationByHandle(organizations, "beta")?.id).toBe("org-b");
  });

  it("lets an id win over another organization's slug", () => {
    const clash = [org("org-a", "org-b"), org("org-b", "beta")];
    expect(findOrganizationByHandle(clash, "org-b")?.id).toBe("org-b");
  });

  it("resolves organizations that have no slug by id only", () => {
    expect(findOrganizationByHandle(organizations, "org-legacy")?.id).toBe("org-legacy");
  });

  it("returns nothing for an unknown or empty handle", () => {
    expect(findOrganizationByHandle(organizations, "nope")).toBeUndefined();
    expect(findOrganizationByHandle([org("org-x", "")], "")).toBeUndefined();
    expect(findOrganizationByHandle([], "alpha")).toBeUndefined();
  });

  it("never resolves the client-side current alias as a stored handle", () => {
    expect(findOrganizationByHandle(organizations, CURRENT_ORGANIZATION_HANDLE)).toBeUndefined();
    expect(findOrganizationByHandle([org("org-c", "current"), org("current", "")], CURRENT_ORGANIZATION_HANDLE)).toBeUndefined();
  });
});
