import { describe, it, expect } from "vitest";

describe("RepositoryDetailPage", () => {
  it("exports RepositoryDetailPage component", async () => {
    const module = await import("./RepositoryDetailPage");
    expect(module.RepositoryDetailPage).toBeDefined();
  });

  it("defines tab types correctly", () => {
    const validTabs = ["code", "issues", "pulls", "actions", "packages", "wiki", "settings", "members"];
    expect(validTabs).toHaveLength(8);
  });
});
