// @vitest-environment node

import { describe, expect, it } from "vitest";
import { highlightRepositorySource } from "./repositorySyntax";

describe("repository Shiki tokenization", () => {
  it("uses the TextMate grammar and returns line-oriented themed tokens", async () => {
    const source = 'const greeting: string = "hello";\nreturn greeting;';
    const result = await highlightRepositorySource(source, "typescript");
    const tokens = result.tokens.flat();

    expect(result.foreground).toMatch(/^#/);
    expect(result.background).toMatch(/^#/);
    expect(result.tokens).toHaveLength(2);
    expect(tokens.some(token => token.content.includes("const") && Boolean(token.color))).toBe(true);
    expect(tokens.some(token => token.content.includes("hello") && Boolean(token.color))).toBe(true);
  });

  it("keeps source payload as token text rather than generated HTML", async () => {
    const result = await highlightRepositorySource('const markup = "<script>alert(1)</script>";', "typescript");
    expect(result.tokens.flat().map(token => token.content).join("")).toContain("<script>");
  });
});
