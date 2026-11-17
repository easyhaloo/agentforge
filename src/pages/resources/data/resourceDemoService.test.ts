import { describe, expect, it } from "vitest";
import { createResourceDraft, resolveResourceAction } from "./resourceDemoService";

describe("resource demo service", () => {
  it("creates entity-specific local drafts", () => {
    expect(createResourceDraft("Projects", " Platform refresh ", "PRJ-123")).toMatchObject({
      kind: "project", id: "PRJ-123", name: "Platform refresh", repositoryCount: 0, lifecycle: "Draft",
    });
    expect(createResourceDraft("Repositories", " API ", "REP-123")).toMatchObject({
      kind: "repository", projectName: "Unassigned", language: "Unknown",
    });
    expect(createResourceDraft("Workspaces", " Agent workspace ", "WS-123")).toMatchObject({
      kind: "workspace", changesetId: "Unlinked", runtime: "Not provisioned",
    });
  });
  it("resolves review, demo, export and no-op actions", () => {
    expect(resolveResourceAction("review-queue", "Review", "Open", 2)?.type).toBe("review-queue");
    expect(resolveResourceAction("demo", "Eval", "Run", 2)?.type).toBe("demo");
    expect(resolveResourceAction("export", "Cost & Usage", "Export", 2)?.type).toBe("export");
    expect(resolveResourceAction("none", "Settings", "Edit", 2)).toBeNull();
  });
});
