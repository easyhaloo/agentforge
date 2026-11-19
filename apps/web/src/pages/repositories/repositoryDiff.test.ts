import { describe, expect, it } from "vitest";
import { parseRepositoryDiff } from "./repositoryDiff";

describe("parseRepositoryDiff", () => {
  it("tracks old and new line numbers across add, remove, and context lines", () => {
    const files = parseRepositoryDiff("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new");
    expect(files).toHaveLength(1);
    expect(files[0].hunks[0].lines.map(line => [line.kind, line.oldLine, line.newLine])).toEqual([
      ["context", 1, 1], ["remove", 2, undefined], ["add", undefined, 2],
    ]);
  });
  it("keeps empty lines and no-newline markers as safe metadata", () => {
    const lines = parseRepositoryDiff("@@ -1 +1 @@\n-\n+\n\\ No newline at end of file")[0].hunks[0].lines;
    expect(lines.map(line => line.kind)).toEqual(["remove", "add", "meta"]);
  });
});
