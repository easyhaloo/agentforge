import { describe, expect, it } from "vitest";
import type { ProjectItem } from "../../shared/api/projects";
import { filterProjectItems, groupProjectItems, parseProjectSourceLink, projectCsv, sortProjectItems } from "./projectViews";

const issue: ProjectItem = { id: "a", kind: "issue", number: 3, title: "Fix exports", repository: "acme/web", status: "in_progress", iteration: "Sprint 8", archived: false, version: 2 };
const draft: ProjectItem = { id: "b", kind: "draft", title: "Triage", status: "todo", priority: "p1", archived: false, version: 1 };

describe("project views", () => {
  it("combines qualifiers and text and keeps unset priorities last", () => {
    expect(filterProjectItems([issue, draft], 'status:in_progress iteration:"Sprint 8" #3')).toEqual([issue]);
    expect(sortProjectItems([issue, draft], "priority")).toEqual([draft, issue]);
    expect(groupProjectItems([draft, issue], "status").map(([status, items]) => [status, items.length])).toEqual([["todo", 1], ["in_progress", 1], ["done", 0]]);
  });

  it("accepts only same-organization source links and escapes spreadsheet formulas", () => {
    const origin = "https://agentforge.example";
    const path = "/orgs/acme/repositories/acme/web/issues/3";
    expect(parseProjectSourceLink(`${origin}${path}`, origin, "acme")).toEqual({ kind: "issue", repository: "acme/web", number: 3 });
    expect(parseProjectSourceLink(`${origin}${path}`, origin, "other")).toBeUndefined();
    expect(parseProjectSourceLink(`https://outside.example${path}`, origin, "acme")).toBeUndefined();
    expect(projectCsv([["=1+1", 'a,"b"']])).toBe('"\'=1+1","a,""b"""\r\n');
  });
});
