import { describe, expect, it } from "vitest";
import { resolveRepositoryMarkdownTarget } from "./repositoryMarkdown";

describe("resolveRepositoryMarkdownTarget", () => {
  it("resolves sibling and parent repository paths", () => {
    expect(resolveRepositoryMarkdownTarget("./guide.md", "docs/README.md")).toEqual({ kind: "internal", path: "docs/guide.md" });
    expect(resolveRepositoryMarkdownTarget("../assets/logo.svg#mark", "docs/README.md")).toEqual({ kind: "internal", path: "assets/logo.svg", fragment: "#mark" });
  });
  it("allows safe external protocols and rejects executable or escaping destinations", () => {
    expect(resolveRepositoryMarkdownTarget("https://example.com", "README.md").kind).toBe("external");
    expect(resolveRepositoryMarkdownTarget("mailto:team@example.com", "README.md").kind).toBe("external");
    expect(resolveRepositoryMarkdownTarget("javascript:alert(1)", "README.md").kind).toBe("unsafe");
    expect(resolveRepositoryMarkdownTarget("//evil.example", "README.md").kind).toBe("unsafe");
    expect(resolveRepositoryMarkdownTarget("../../secret", "docs/README.md").kind).toBe("unsafe");
  });
});
