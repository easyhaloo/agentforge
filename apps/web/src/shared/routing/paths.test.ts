import { describe, expect, it } from "vitest";
import { CURRENT_ORGANIZATION_HANDLE, flatPaths, orgPath, webIDEPath, withOrganizationHandle } from "./paths";

describe("flat (mock page) paths", () => {
  it("matches the documented URL scheme for every flat page", () => {
    expect(flatPaths).toEqual({
      overview: "/",
      projects: "/projects",
      workspaces: "/workspaces",
      stacks: "/stacks",
      selfHealing: "/self-healing",
      memory: "/memory",
      security: "/security",
      governance: "/governance",
      usage: "/usage",
      settings: "/settings",
      uiComponents: "/dev/ui",
    });
  });
});

describe("organization-scoped paths", () => {
  it.each([
    ["changesets", "/orgs/demo/changesets"],
    ["pipelines", "/orgs/demo/pipelines"],
    ["repositories", "/orgs/demo/repositories"],
    ["trails", "/orgs/demo/trails"],
    ["review", "/orgs/demo/review"],
    ["eval", "/orgs/demo/eval"],
    ["settings", "/orgs/demo/settings"],
  ] as const)("builds the %s page under the organization handle", (section, expected) => {
    expect(orgPath("demo", section)).toBe(expected);
  });

  it("builds an id handle exactly like a slug handle", () => {
    expect(orgPath("org-demo", "changesets")).toBe("/orgs/org-demo/changesets");
  });

  it("percent-encodes handles so they always stay a single path segment", () => {
    expect(orgPath("a b", "changesets")).toBe("/orgs/a%20b/changesets");
    expect(orgPath("a/b", "trails")).toBe("/orgs/a%2Fb/trails");
    expect(orgPath("x?y#z", "eval")).toBe("/orgs/x%3Fy%23z/eval");
    expect(orgPath("équipe", "review")).toBe("/orgs/%C3%A9quipe/review");
  });

  it("treats the client-side current alias like any other handle", () => {
    expect(CURRENT_ORGANIZATION_HANDLE).toBe("current");
    expect(orgPath(CURRENT_ORGANIZATION_HANDLE, "changesets")).toBe("/orgs/current/changesets");
  });
});

describe("webIDEPath", () => {
  it("points at the WebIDE page of the organization", () => {
    expect(webIDEPath("demo", { repository: "agentforge" })).toBe("/orgs/demo/webide?repository=agentforge");
  });

  it("carries the revision, the changeset, the path and the line as query parameters", () => {
    expect(webIDEPath("demo", {
      repository: "agentforge",
      commit: "abc123",
      changeset: "cs-1",
      path: "src/main.go",
      line: 42,
    })).toBe("/orgs/demo/webide?repository=agentforge&commit=abc123&changeset=cs-1&path=src%2Fmain.go&line=42");
  });

  it("leaves out the parameters that were not given", () => {
    expect(webIDEPath("demo", { repository: "agentforge", commit: "abc123" })).toBe(
      "/orgs/demo/webide?repository=agentforge&commit=abc123",
    );
  });

  it("encodes the handle and the repository so they stay one path segment", () => {
    expect(webIDEPath("a b", { repository: "x/y" })).toBe("/orgs/a%20b/webide?repository=x%2Fy");
  });
});

describe("withOrganizationHandle", () => {
  it("swaps only the handle and keeps the sub-path", () => {
    expect(withOrganizationHandle("/orgs/a/settings", "b")).toBe("/orgs/b/settings");
    expect(withOrganizationHandle("/orgs/current/trails", "demo")).toBe("/orgs/demo/trails");
  });

  it("encodes the replacement handle", () => {
    expect(withOrganizationHandle("/orgs/a/changesets", "x y/z")).toBe("/orgs/x%20y%2Fz/changesets");
  });

  it("leaves paths outside /orgs/:org untouched", () => {
    expect(withOrganizationHandle("/projects", "b")).toBe("/projects");
    expect(withOrganizationHandle("/", "b")).toBe("/");
  });

  it("finds /orgs the way the router does (case-insensitively) and emits the canonical lowercase prefix", () => {
    expect(withOrganizationHandle("/ORGS/current/changesets", "demo")).toBe("/orgs/demo/changesets");
    expect(withOrganizationHandle("/Orgs/a/settings", "b")).toBe("/orgs/b/settings");
  });

  it("does not treat look-alike prefixes as an organization path", () => {
    expect(withOrganizationHandle("/organizations/a", "b")).toBe("/organizations/a");
    expect(withOrganizationHandle("/orgs", "b")).toBe("/orgs");
  });
});
