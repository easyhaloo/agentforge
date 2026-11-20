import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RepositoryReadme } from "./RepositoryReadme";

describe("RepositoryReadme", () => {
  it("renders a bounded Markdown subset and escapes raw HTML", () => {
    const html = renderToStaticMarkup(<RepositoryReadme content={"# Hello\n\n**safe** and `code`\n\n<script>alert(1)</script>"} />);
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<strong>safe</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders relative images through the authenticated repository image endpoint", () => {
    const html = renderToStaticMarkup(<RepositoryReadme content={"![logo](../assets/logo.png)"} sourcePath="docs/README.md" onOpenImage={path => "/api/image?path=" + encodeURIComponent(path)} />);
    expect(html).toContain('<img');
    expect(html).toContain('src="/api/image?path=assets%2Flogo.png"');
    expect(html).toContain('alt="logo"');
  });

  it("does not embed external or unsafe image URLs", () => {
    const html = renderToStaticMarkup(<RepositoryReadme content={"![remote](https://tracker.example/pixel.png) ![unsafe](javascript:alert(1))"} sourcePath="README.md" onOpenImage={path => "/api/image?path=" + encodeURIComponent(path)} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("tracker.example");
  });

  it("rejects executable and protocol-relative links", () => {
    const html = renderToStaticMarkup(<RepositoryReadme content={"[bad](javascript:alert(1)) [good](https://example.com)"} />);
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.com/"');
  });
});
