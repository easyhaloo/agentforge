import { describe, expect, it } from "vitest";
import { createResourceDraft, resolveResourceAction } from "./resourceDemoService";

describe("resource demo service", () => {
  it("creates typed local drafts for every creatable resource page", () => {
    const cases = [
      ["Projects", "project"],
      ["Changesets", "changeset"],
      ["Workspaces", "workspace"],
      ["Trails", "trail"],
      ["Stacks", "stack"],
      ["Memory", "memory-entry"],
      ["Security", "security-finding"],
      ["Governance", "governance-policy"],
    ] as const;
    for (const [page, kind] of cases) {
      expect(createResourceDraft(page, " New record ", "NEW-1")).toMatchObject({
        kind, id: "NEW-1", name: "New record", owner: "You",
      });
    }
  });

  it("resolves review, demo, export and no-op actions", () => {
    expect(resolveResourceAction("review-queue", "Review", "Open", 2)?.type).toBe("review-queue");
    expect(resolveResourceAction("demo", "Eval", "Run", 2)?.type).toBe("demo");
    expect(resolveResourceAction("export", "Cost & Usage", "Export", 2)?.type).toBe("export");
    expect(resolveResourceAction("none", "Settings", "Edit", 2)).toBeNull();
  });
});
