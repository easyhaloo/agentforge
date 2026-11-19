import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { repositoryLanguage, RepositorySourceViewer } from "./RepositorySourceViewer";

describe("RepositorySourceViewer", () => {
  it("detects common source languages", () => {
    expect(repositoryLanguage("src/main.ts")).toBe("TypeScript");
    expect(repositoryLanguage("config.yaml")).toBe("YAML");
    expect(repositoryLanguage("Dockerfile")).toBe("Dockerfile");
  });
  it("marks the requested active line for editor deep links", () => {
    const html = renderToStaticMarkup(<RepositorySourceViewer path="src/main.ts" content={"first\\nsecond"} activeLine={2}/>);
    expect(html).toContain("repository-source__line--active");
    expect(html).toContain('id="line-2"');
  });
  it("renders escaped source with line numbers and token classes", () => {
    const html = renderToStaticMarkup(<RepositorySourceViewer path="src/main.ts" content={'const name = "AgentForge";\nreturn 42;\n<script>'} />);
    expect(html).toContain('class="repository-source__number"');
    expect(html).toContain('repository-code__token--keyword');
    expect(html).toContain('repository-code__token--string');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
