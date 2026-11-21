import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { matchPath, matchRoutes, type RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { itemHref, navigationItems } from "./navigation";
import { routes } from "./routes";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const joinPath = (base: string, path = "") => `/${base}/${path}`.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");

/** Full URL pattern of every leaf route in the table, e.g. "/projects", "/orgs/:org/changesets", "/*". */
function leafPatterns(table: readonly RouteObject[], base = ""): string[] {
  return table.flatMap((route) => route.children?.length
    ? leafPatterns(route.children, joinPath(base, route.path))
    : [joinPath(base, route.index ? "" : route.path)]);
}

const catchAllPattern = "/*";
const pagePatterns = leafPatterns(routes).filter((pattern) => pattern !== catchAllPattern);
const pagesMatching = (pathname: string) => pagePatterns.filter((pattern) => matchPath({ path: pattern, end: true }, pathname));
const leafOf = (pathname: string) => matchRoutes(routes, pathname)?.at(-1);

describe("route table", () => {
  it("routes every navigation item to exactly one real page labelled like the item", () => {
    for (const item of navigationItems) {
      const pathname = itemHref(item, "demo");
      expect(pagesMatching(pathname), `${item.label} (${pathname}) must match exactly one page route`).toHaveLength(1);
      const leaf = leafOf(pathname);
      expect(leaf?.route.path, `${item.label} must not fall through to the catch-all`).not.toBe("*");
      expect(leaf?.route.handle, `${item.label} route label`).toEqual({ label: item.label });
    }
  });

  it("gives every navigation item its own route", () => {
    const routeOfEachItem = navigationItems.map((item) => leafOf(itemHref(item, "demo"))?.route);
    expect(new Set(routeOfEachItem).size).toBe(navigationItems.length);
  });

  it("serves the live pages and their aliases under /orgs/:org", () => {
    const labels: Record<string, string> = { webide: "WebIDE", issues: "Issues", changesets: "Changesets", trails: "Trails", review: "Review", eval: "Eval", settings: "Organization" };
    for (const [section, label] of Object.entries(labels)) {
      const leaf = leafOf(`/orgs/x/${section}`);
      expect(leaf?.params.org, section).toBe("x");
      expect(leaf?.route.handle, section).toEqual({ label });
    }
  });

  it("hands the organization handle to the page decoded, including the current alias", () => {
    expect(leafOf("/orgs/a%20b/trails")?.params.org).toBe("a b");
    expect(leafOf("/orgs/a%2Fb/trails")?.params.org).toBe("a/b");
    expect(leafOf("/orgs/current/changesets")?.params.org).toBe("current");
  });

  it("serves the repository directory and repository sections under the organization", () => {
    expect(leafOf("/orgs/demo/repositories")?.route.handle).toEqual({ label: "Repositories" });
    for (const suffix of ["", "/branches", "/actions", "/settings", "/issues"]) {
      const leaf = leafOf(`/orgs/demo/repositories/team/repo${suffix}`);
      expect(leaf?.params, suffix).toMatchObject({ org: "demo", owner: "team", repo: "repo" });
      expect(leaf?.route.handle, suffix).toEqual({ label: "Repository" });
    }
  });

  it("matches issue details and preserves the legacy repository route", () => {
    const detail = leafOf("/orgs/demo/repositories/team/repo/issues/42");
    expect(detail?.params).toMatchObject({ org: "demo", owner: "team", repo: "repo", number: "42" });
    expect(detail?.route.handle).toEqual({ label: "Issue" });

    const legacy = leafOf("/orgs/demo/repositories/repo");
    expect(legacy?.params).toMatchObject({ org: "demo", repositorySlug: "repo" });
    expect(legacy?.route.handle).toEqual({ label: "Repository" });
  });

  it("serves the changeset detail page under the organization", () => {
    const leaf = leafOf("/orgs/demo/changesets/CS-1");
    expect(leaf?.params).toMatchObject({ org: "demo", id: "CS-1" });
    expect(leaf?.route.handle).toEqual({ label: "Changeset" });
  });

  it("serves every part of a changeset as its own route", () => {
    for (const tab of ["revisions", "evaluation", "review", "merge"]) {
      const leaf = leafOf(`/orgs/demo/changesets/CS-1/${tab}`);
      expect(leaf?.params, tab).toMatchObject({ org: "demo", id: "CS-1" });
      expect(leaf?.route.handle, tab).toEqual({ label: "Changeset" });
    }
  });

  it("sends every other path to the catch-all, including backend paths and partial organization paths", () => {
    for (const pathname of ["/nope", "/orgs", "/orgs/x", "/orgs/x/", "/orgs/x/nope", "/orgs/x/changesets/extra/other", "/projects/extra", "/dev", "/api/v1/me", "/auth/oidc/login"]) {
      const leaf = leafOf(pathname);
      expect(leaf?.route.path, pathname).toBe("*");
      expect(leaf?.route.handle, pathname).toEqual({ label: "Page not found" });
    }
  });
});

describe("error boundaries", () => {
  it("gives the root layout its own fallback and keeps every page inside a boundary below it, so a failing page leaves the shell in place", () => {
    expect(routes[0].errorElement, "root route fallback (errors thrown by the layout itself)").toBeTruthy();
    for (const pathname of [...navigationItems.map((item) => itemHref(item, "demo")), "/nope"]) {
      const matches = matchRoutes(routes, pathname);
      expect(matches, pathname).not.toBeNull();
      const boundary = matches!.findIndex((match, index) => index > 0 && match.route.errorElement);
      expect(boundary, `${pathname} needs an errorElement route between the root layout and the page`).toBeGreaterThan(0);
    }
  });
});

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return collectSourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("route declarations", () => {
  it("lives only in app/routes.tsx; the router itself is created only by main.tsx", () => {
    const declaration = /<Routes?\b|\buseRoutes\s*\(|\bRouteObject\b|\bcreate(?:Browser|Memory|Hash)Router\s*\(/g;
    const violations: string[] = [];
    for (const file of collectSourceFiles(sourceRoot)) {
      const path = relative(sourceRoot, file).split(sep).join("/");
      if (/\.test\.tsx?$/.test(path) || path === "app/routes.tsx") continue;
      for (const match of readFileSync(file, "utf8").matchAll(declaration)) {
        if (path === "main.tsx" && match[0].startsWith("createBrowserRouter")) continue;
        violations.push(`${path}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
