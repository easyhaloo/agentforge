import { describe, expect, it } from "vitest";
import { buildResourceCsv } from "./resourceExport";
import type { Item, ResourceColumn } from "./resourceConfigs";

const columns: ResourceColumn[] = [
  { label: "Name", field: "name" },
  { label: "Detail", field: "detail" },
];

const item: Item = {
  id: "USE-1",
  name: 'Model "A"',
  detail: "Agent, 12 calls",
  status: "$1.20",
  updated: "Today",
  owner: "Platform",
};

describe("buildResourceCsv", () => {
  it("exports configured columns in their declared order", () => {
    expect(buildResourceCsv([item], columns)).toBe(
      'Name,Detail\r\n"Model ""A""","Agent, 12 calls"\r\n',
    );
  });

  it("exports a header when there are no matching rows", () => {
    expect(buildResourceCsv([], columns)).toBe("Name,Detail\r\n");
  });
});
