import { describe, expect, it } from "vitest";
import { getDiffFilePath } from "./RepositoryDiffViewer";
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

it("decodes Git-quoted UTF-8 paths for review anchors", () => {
  const files = parseRepositoryDiff(String.raw`diff --git "a/\346\265\213\350\257\225.md" "b/\346\265\213\350\257\225.md"` + "\n@@ -7,0 +8 @@\n+new");
  expect(getDiffFilePath(files[0])).toBe("测试.md");
});
