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

  it("rejects executable and protocol-relative links", () => {
    const html = renderToStaticMarkup(<RepositoryReadme content={"[bad](javascript:alert(1)) [good](https://example.com)"} />);
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.com/"');
  });
});
