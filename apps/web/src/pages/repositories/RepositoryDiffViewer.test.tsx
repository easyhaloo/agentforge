import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RepositoryDiffViewer } from "./RepositoryDiffViewer";

describe("RepositoryDiffViewer", () => {
  it("preserves diff markers and both line-number columns on first paint", () => {
    const patch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1,2 +1,2 @@",
      " const before = true;",
      "-const value = 1;",
      "+const value = 2;",
    ].join("\n");
    const html = renderToStaticMarkup(<RepositoryDiffViewer patch={patch} />);

    expect(html).toContain('data-highlight-engine="pending"');
    expect(html).toContain("repository-diff__line--remove");
    expect(html).toContain("repository-diff__line--add");
    expect(html).toContain("<span>2</span><span></span>");
    expect(html).toContain("<span></span><span>2</span>");
    expect(html).toContain("-const value = 1;");
    expect(html).toContain("+const value = 2;");
  });

  it("renders source payload as escaped text", () => {
    const html = renderToStaticMarkup(<RepositoryDiffViewer patch={[
      "diff --git a/src/example.ts b/src/example.ts",
      "@@ -1 +1 @@",
      '-const value = "<script>";',
    ].join("\n")} />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
