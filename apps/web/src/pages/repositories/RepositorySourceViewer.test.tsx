import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeAll } from "vitest";
import i18n from "../../locales";
import { repositoryLanguage, RepositorySourceViewer, shouldHighlightRepositorySource } from "./RepositorySourceViewer";
import { detectCodeLanguage, listCodeLanguages } from "../../shared/code/languages";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});

describe("RepositorySourceViewer", () => {
  it("detects common source languages", () => {
    expect(repositoryLanguage("src/main.ts")).toBe("TypeScript");
    expect(repositoryLanguage("config.yaml")).toBe("YAML");
    expect(repositoryLanguage("Dockerfile")).toBe("Dockerfile");
    expect(repositoryLanguage("scripts/run", "#!/usr/bin/env python3")).toBe("Python");
    expect(repositoryLanguage(".github/workflows/ci.yml")).toBe("YAML");
  });
  it("exposes shared Shiki and Monaco language metadata", () => {
    expect(detectCodeLanguage("src/main.ts")?.shiki).toBe("typescript");
    expect(detectCodeLanguage("src/main.ts")?.monaco).toBe("typescript");
    expect(listCodeLanguages().length).toBeGreaterThan(15);
  });
  it("keeps syntax highlighting bounded and uses plaintext for unknown languages", () => {
    expect(shouldHighlightRepositorySource("src/main.ts", "const value = 1;")).toBe(true);
    expect(shouldHighlightRepositorySource("assets/data.unknown", "const value = 1;")).toBe(false);
    expect(shouldHighlightRepositorySource("src/main.ts", "x".repeat(256 * 1024 + 1))).toBe(false);
    expect(shouldHighlightRepositorySource("src/main.ts", "é".repeat(128 * 1024 + 1))).toBe(false);
    expect(shouldHighlightRepositorySource("src/main.ts", Array.from({ length: 10_001 }, () => "x").join("\n"))).toBe(false);
  });
  it("marks the requested active line for editor deep links", () => {
    const html = renderToStaticMarkup(<RepositorySourceViewer path="src/main.ts" content={"first\nsecond"} activeLine={2}/>);
    expect(html).toContain("repository-source__line--active");
    expect(html).toContain('id="line-2"');
  });
  it("renders escaped plaintext immediately before asynchronous Shiki highlighting", () => {
    const html = renderToStaticMarkup(<RepositorySourceViewer path="src/main.ts" content={'const name = "AgentForge";\nreturn 42;\n<script>'} />);
    expect(html).toContain('class="repository-source__number"');
    expect(html).toContain("const name");
    expect(html).toContain('data-highlight-engine="plain-text"');
    expect(html).not.toContain("repository-code__token--");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("renders unknown and oversized source as escaped plaintext", () => {
    const unknown = renderToStaticMarkup(<RepositorySourceViewer path="data.unknown" content={'const value = "<script>";'} />);
    expect(unknown).not.toContain("repository-code__token--keyword");
    expect(unknown).toContain("&lt;script&gt;");

    const large = renderToStaticMarkup(<RepositorySourceViewer path="src/main.ts" content={"x".repeat(256 * 1024 + 1)} />);
    expect(large).not.toContain("repository-code__token--");
  });
  it("describes the file in the language the reader chose", async () => {
    expect(renderToStaticMarkup(<RepositorySourceViewer path="src/main.ts" content={"const a = 1;\nconst b = 2;"} />))
      .toContain("TypeScript · 2 lines");

    await i18n.changeLanguage("zh-CN");
    try {
      expect(renderToStaticMarkup(<RepositorySourceViewer path="src/main.ts" content={"const a = 1;"} />))
        .toContain("TypeScript · 1 行");
    } finally {
      await i18n.changeLanguage("en-US");
    }
  });
});
