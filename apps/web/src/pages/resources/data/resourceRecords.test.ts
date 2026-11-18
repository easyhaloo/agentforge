import { describe, expect, it } from "vitest";
import {
  migrateResourceRecords,
  normalizeResourceRecords,
  toResourceRow,
} from "./resourceRecords";
import { configs } from "./resourceConfigs";

const legacy = {
  id: "PRJ-014", name: "Core Platform", detail: "8 repositories · Runtime & APIs",
  status: "Active", updated: "4 min ago", owner: "Platform",
};

describe("resource record migration", () => {
  it("migrates project and workspace rows into entity-specific fields", () => {
    const [project] = migrateResourceRecords([legacy], "Projects", []);
    const [workspace] = migrateResourceRecords([{ ...legacy, id: "WS-1", detail: "CS-2481 · Linux x64", status: "Ready" }], "Workspaces", []);
    expect(project).toMatchObject({ kind: "project", repositoryCount: 8, description: "Runtime & APIs" });
    expect(workspace).toMatchObject({ kind: "workspace", changesetId: "CS-2481", runtime: "Linux x64" });
    expect(toResourceRow(project)).toEqual(legacy);
  });

  it("migrates every resource page into its dedicated discriminated record", () => {
    const expectedKinds: Record<string, string> = {
      Projects: "project", Changesets: "changeset",
      Workspaces: "workspace", Trails: "trail", Stacks: "stack", Review: "review",
      Eval: "evaluation", "Self-healing": "repair-session", Memory: "memory-entry",
      "CI / CD": "pipeline-run", Security: "security-finding", Governance: "governance-policy",
      "Cost & Usage": "usage", Settings: "setting",
    };
    for (const [page, config] of Object.entries(configs)) {
      const migrated = migrateResourceRecords(config.items.map(toResourceRow), page, []);
      expect(migrated.length, page).toBe(config.items.length);
      expect(migrated.every((record) => record.kind === expectedKinds[page]), page).toBe(true);
      expect(migrated.map(toResourceRow), page).toEqual(config.items.map(toResourceRow));
    }
  });

  it("preserves normalized records and supports mixed old/new persisted arrays", () => {
    const normalized = configs.Projects.items;
    expect(normalizeResourceRecords(normalized, "Projects", [])).toBe(normalized);
    const mixed = [normalized[0], legacy];
    expect(normalizeResourceRecords(mixed, "Projects", [])).toHaveLength(2);
  });

  it("falls back safely for malformed persisted data", () => {
    const fallback = configs.Projects.items;
    expect(normalizeResourceRecords([{ id: "broken" }], "Projects", fallback)).toBe(fallback);
    expect(normalizeResourceRecords("not-json-array", "Projects", fallback)).toBe(fallback);
  });
});
