import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextAreaEditorAdapter } from "./EditorAdapter";

describe("TextAreaEditorAdapter", () => {
  it("exposes editor metadata while keeping the buffer controlled", () => {
    const html = renderToStaticMarkup(
      <TextAreaEditorAdapter
        path="src/main.ts"
        languageId="typescript"
        value="const value = 1"
        onChange={() => undefined}
        readOnly={false}
        activeLine={3}
      />,
    );
    expect(html).toContain('data-editor-adapter="textarea"');
    expect(html).toContain('data-editor-path="src/main.ts"');
    expect(html).toContain('data-editor-language="typescript"');
    expect(html).toContain('data-active-line="3"');
    expect(html).toContain("const value = 1");
  });

  it("keeps read-only state at the editor boundary", () => {
    const html = renderToStaticMarkup(
      <TextAreaEditorAdapter
        path="README.md"
        languageId="markdown"
        value="read only"
        onChange={() => undefined}
        readOnly
      />,
    );
    expect(html).toContain("disabled");
  });
});
