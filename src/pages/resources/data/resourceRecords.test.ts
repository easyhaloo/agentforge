import { describe, expect, it } from "vitest";
import {
  migrateResourceRecords,
  normalizeResourceRecords,
  toResourceRow,
} from "./resourceRecords";

const legacy = {
  id: "PRJ-014",
  name: "Core Platform",
  detail: "8 repositories · Runtime & APIs",
  status: "Active",
  updated: "4 min ago",
  owner: "Platform",
};

describe("resource record migration", () => {
  it("migrates legacy project rows into project-specific fields", () => {
    const [record] = migrateResourceRecords([legacy], "Projects", []);
    expect(record).toMatchObject({
      kind: "project",
      repositoryCount: 8,
      description: "Runtime & APIs",
      lifecycle: "Active",
    });
    expect(toResourceRow(record)).toEqual(legacy);
  });

  it("migrates repository and workspace rows into their own shapes", () => {
    const [repository] = migrateResourceRecords([{
      ...legacy,
      id: "REP-1",
      detail: "Project Core Platform · TypeScript",
      status: "Healthy",
    }], "Repositories", []);
    const [workspace] = migrateResourceRecords([{
      ...legacy,
      id: "WS-1",
      detail: "CS-2481 · Linux x64",
      status: "Ready",
    }], "Workspaces", []);

    expect(repository).toMatchObject({ kind: "repository", projectName: "Core Platform", language: "TypeScript" });
    expect(workspace).toMatchObject({ kind: "workspace", changesetId: "CS-2481", runtime: "Linux x64" });
  });

  it("preserves already normalized entity records", () => {
    const normalized = [{ kind: "project", id: "P-1", name: "Core", description: "APIs", repositoryCount: 2, lifecycle: "Active", updatedAt: "Now", owner: "Team" }];
    expect(normalizeResourceRecords(normalized, "Projects", [])).toBe(normalized);
  });

  it("falls back safely for malformed persisted data", () => {
    const fallback = [{ kind: "resource" as const, ...legacy }];
    expect(normalizeResourceRecords([{ id: "broken" }], "Projects", fallback)).toBe(fallback);
    expect(normalizeResourceRecords("not-json-array", "Projects", fallback)).toBe(fallback);
  });
});
