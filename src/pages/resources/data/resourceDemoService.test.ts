import { describe, expect, it } from "vitest";
import { createResourceDraft, resolveResourceAction } from "./resourceDemoService";

describe("resource demo service", () => {
  it("creates an explicit local draft without performing remote work", () => {
    expect(createResourceDraft("Projects", "  Platform refresh  ", "PRJ-123")).toEqual({
      id: "PRJ-123",
      name: "Platform refresh",
      detail: "Created in Projects · local demo record",
      status: "Draft",
      updated: "Just now",
      owner: "You",
    });
  });

  it("resolves review queue actions to the pending filter", () => {
    expect(resolveResourceAction("review-queue", "Review", "Open reviews", 4)).toEqual({
      type: "review-queue",
      query: "",
      status: "Pending",
      message: "Showing pending review decisions from local demo data.",
    });
  });

  it("labels demo actions as local simulations", () => {
    expect(resolveResourceAction("demo", "Eval", "Simulate evaluation", 4)).toEqual({
      type: "demo",
      message: "Simulate evaluation: local demo simulation only; no remote operation was performed.",
    });
  });

  it("returns export metadata without invoking browser APIs", () => {
    expect(resolveResourceAction("export", "Cost & Usage", "Export CSV", 3)).toEqual({
      type: "export",
      filename: "agentforge-cost-usage.csv",
      recordCount: 3,
      message: "Exported 3 local demo records to agentforge-cost-usage.csv.",
    });
  });

  it("does not resolve create or disabled actions as side effects", () => {
    expect(resolveResourceAction("create", "Projects", "Create project", 4)).toBeNull();
    expect(resolveResourceAction("none", "Settings", "Edit settings", 4)).toBeNull();
  });
});
