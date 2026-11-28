import { render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryDiffViewer } from "./RepositoryDiffViewer";

vi.mock("./repositorySyntax", () => ({
  highlightRepositorySource: vi.fn(async (source: string) => ({
    tokens: source.split("\n").map(line => [{ content: line, color: "#ff0000", fontStyle: 0 }]),
    foreground: "#ffffff",
    background: "#000000",
  })),
}));

describe("RepositoryDiffViewer", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("applies Shiki token colors asynchronously without changing diff row structure", async () => {
    const patch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "@@ -1 +1 @@",
      "-const value = 1;",
      "+const value = 2;",
    ].join("\n");
    const { container } = render(<RepositoryDiffViewer patch={patch} />);

    await waitFor(() => expect(container.querySelector('[data-highlight-engine="shiki"]')).not.toBeNull());
    expect(container.querySelectorAll(".repository-diff__line--remove")).toHaveLength(1);
    expect(container.querySelectorAll(".repository-diff__line--add")).toHaveLength(1);
    expect(container.querySelector(".repository-diff__line--add .repository-code__shiki-token")?.getAttribute("style")).toContain("color: #ff0000");
  });

  it("pairs consecutive changes, keeps missing sides blank, and anchors discussions to the original line numbers", async () => {
    const patch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "@@ -7,5 +20,5 @@",
      " keep", "-first old", "-second old", "\\ No newline at end of file", "+first new",
      " next context", "-third old", "+second new", "+third new",
    ].join("\n");
    const { container } = render(<RepositoryDiffViewer patch={patch} viewMode="split"
      lineControl={(path, side, line) => <span data-anchor={`${path}:${side}:${line}`}>{line}</span>}
      lineDiscussion={(_path, side, line) => <div data-discussion={`${side}:${line}`}/>}/>);
    const rows = [...container.querySelectorAll(".repository-diff__split-row")];
    const anchors = (row: Element) => [...row.querySelectorAll("[data-anchor]")]
      .map(element => element.getAttribute("data-anchor")?.replace("src/example.ts:", ""));

    expect(rows.map(anchors)).toEqual([
      ["left:7", "right:20"], ["left:8", "right:21"], ["left:9"], ["left:10", "right:22"], ["left:11", "right:23"], ["right:24"],
    ]);
    expect(rows[2].querySelector('.repository-diff__split-empty[data-side="right"]')).not.toBeNull();
    expect(rows[2].querySelector('[data-side="left"] code')?.textContent).toContain("\\ No newline at end of file");
    expect(rows[5].querySelector('.repository-diff__split-empty[data-side="left"]')).not.toBeNull();
    expect(rows[1].nextElementSibling?.getAttribute("data-discussion")).toBe("left:8");
    expect(rows[1].nextElementSibling?.nextElementSibling?.getAttribute("data-discussion")).toBe("right:21");
    await waitFor(() => {
      expect(rows[1].querySelector('[data-side="right"] .repository-code__shiki-token')?.textContent).toBe("first new");
      expect(rows[3].querySelector('[data-side="left"] .repository-code__shiki-token')?.textContent).toBe("next context");
    });
  });

  it.each(["unified", "split"] as const)("renders source payload as escaped text in %s before and after highlighting", async viewMode => {
    const patch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "@@ -1 +1 @@",
      '-const value = "<script>";',
    ].join("\n");
    const html = renderToStaticMarkup(<RepositoryDiffViewer patch={patch} viewMode={viewMode}/>);
    expect(html).toContain("&lt;script&gt;");
    const { container } = render(<RepositoryDiffViewer patch={patch} viewMode={viewMode}/>);
    await waitFor(() => expect(container.querySelector(".repository-code__shiki-token")?.innerHTML).toContain("&lt;script&gt;"));
    expect(container.querySelector("script")).toBeNull();
  });
});
