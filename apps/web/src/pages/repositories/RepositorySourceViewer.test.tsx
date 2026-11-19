import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeAll } from "vitest";
import i18n from "../../locales";
import { repositoryLanguage, RepositorySourceViewer } from "./RepositorySourceViewer";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});

describe("RepositorySourceViewer", () => {
  it("detects common source languages", () => {
    expect(repositoryLanguage("src/main.ts")).toBe("TypeScript");
    expect(repositoryLanguage("config.yaml")).toBe("YAML");
    expect(repositoryLanguage("Dockerfile")).toBe("Dockerfile");
  });
  it("renders escaped source with line numbers and token classes", () => {
    const html = renderToStaticMarkup(<RepositorySourceViewer path="src/main.ts" content={'const name = "AgentForge";\nreturn 42;\n<script>'} />);
    expect(html).toContain('class="repository-source__number"');
    expect(html).toContain('repository-code__token--keyword');
    expect(html).toContain('repository-code__token--string');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
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
