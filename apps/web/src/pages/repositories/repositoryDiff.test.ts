import { describe, expect, it } from "vitest";
import { getDiffFilePath } from "./RepositoryDiffViewer";
import { parseRepositoryDiff } from "./repositoryDiff";

describe("parseRepositoryDiff", () => {
  it("reads file status and counts changes across hunks without counting Git headers", () => {
    const patch = [
      "diff --git a/added b/added", "new file mode 100644", "--- /dev/null", "+++ b/added", "@@ -0,0 +1 @@", "+new",
      "diff --git a/deleted b/deleted", "deleted file mode 100644", "--- a/deleted", "+++ /dev/null", "@@ -1 +0,0 @@", "-old",
      "diff --git a/old b/renamed", "similarity index 100%", "rename from old", "rename to renamed",
      "diff --git a/changed b/changed", "--- a/changed", "+++ b/changed",
      "@@ -1,2 +1,2 @@", " keep", "-old", "+new", "@@ -6,0 +7,2 @@", "+one", "+two",
    ].join("\n");
    expect(parseRepositoryDiff(patch).map(({ status, additions, deletions }) => [status, additions, deletions])).toEqual([
      ["added", 1, 0], ["deleted", 0, 1], ["renamed", 0, 0], ["modified", 3, 1],
    ]);
  });

  it.each([
    ["new file mode 100644", "added"], ["--- /dev/null", "added"],
    ["deleted file mode 100644", "deleted"], ["+++ /dev/null", "deleted"],
    ["rename from before", "renamed"], ["rename to after", "renamed"],
  ])("infers status from %s alone", (header, status) => {
    expect(parseRepositoryDiff(`diff --git a/before b/after\n${header}`)[0].status).toBe(status);
  });

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

it("takes the destination path from rename metadata when Git only quotes one side", () => {
  const patch = String.raw`diff --git a/old.md "b/src/\346\265\213\350\257\225.md"
rename from old.md
rename to "src/\346\265\213\350\257\225.md"`;
  expect(getDiffFilePath(parseRepositoryDiff(patch)[0])).toBe("src/测试.md");
});
