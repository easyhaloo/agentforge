import { render, waitFor } from "@testing-library/react";
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
    const { container } = render(<RepositoryDiffViewer patch={patch} />);
    const html = container.innerHTML;

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
    expect(container.querySelector('.repository-diff__line--add .repository-code__shiki-token')).toHaveStyle({ color: "rgb(255, 0, 0)" });
  });

  it("renders source payload as escaped text", () => {
    const patch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "@@ -1 +1 @@",
      '-const value = "<script>";',
    ].join("\n");
    const { container } = render(<RepositoryDiffViewer patch={patch} />);
    expect(container.innerHTML).toContain("&lt;script&gt;");
    expect(container.querySelector("script")).toBeNull();
  });
});
