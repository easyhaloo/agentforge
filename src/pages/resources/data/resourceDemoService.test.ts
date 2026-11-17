import { describe, expect, it } from "vitest";
import { createResourceDraft, resolveResourceAction } from "./resourceDemoService";

describe("resource demo service", () => {
  it("creates a typed local draft without remote side effects", () => {
    expect(createResourceDraft("Projects", " Platform refresh ", "PRJ-123")).toEqual({
      kind: "resource", id: "PRJ-123", name: "Platform refresh",
      detail: "Created in Projects · local demo record", status: "Draft",
      updated: "Just now", owner: "You",
    });
  });
  it("resolves review, demo, export and no-op actions", () => {
    expect(resolveResourceAction("review-queue", "Review", "Open", 2)?.type).toBe("review-queue");
    expect(resolveResourceAction("demo", "Eval", "Run", 2)?.type).toBe("demo");
    expect(resolveResourceAction("export", "Cost & Usage", "Export", 2)?.type).toBe("export");
    expect(resolveResourceAction("none", "Settings", "Edit", 2)).toBeNull();
  });
});
