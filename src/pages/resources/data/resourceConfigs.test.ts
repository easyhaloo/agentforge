import { describe, expect, it } from "vitest";
import { configs } from "./resourceConfigs";
import { toResourceRow } from "./resourceRecords";

describe("resource page configuration", () => {
  it("defines valid table columns for every resource page projection", () => {
    for (const [page, config] of Object.entries(configs)) {
      expect(config.columns.length, page).toBeGreaterThan(0);
      const rows = config.items.map(toResourceRow);
      for (const column of config.columns) {
        expect(rows.every((row) => typeof row[column.field] === "string"), page).toBe(true);
      }
    }
  });

  it("uses dedicated behavior for non-create actions", () => {
    expect(configs.Review.actionMode).toBe("review-queue");
    expect(configs.Eval.actionMode).toBe("demo");
    expect(configs["Self-healing"].actionMode).toBe("demo");
    expect(configs["CI / CD"].actionMode).toBe("demo");
    expect(configs["Cost & Usage"].actionMode).toBe("export");
    expect(configs.Settings.actionMode).toBe("none");
  });

  it("uses entity-specific record models for core resource pages", () => {
    expect(configs.Projects.items.every((record) => record.kind === "project")).toBe(true);
    expect(configs.Repositories.items.every((record) => record.kind === "repository")).toBe(true);
    expect(configs.Workspaces.items.every((record) => record.kind === "workspace")).toBe(true);
  });
});
