import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TextAreaEditorAdapter, type EditorController } from "./EditorAdapter";

describe("TextAreaEditorAdapter", () => {
  it("exposes editor metadata while keeping the buffer controlled", () => {
    const html = renderToStaticMarkup(
      <TextAreaEditorAdapter
        path="src/main.ts"
        modelKey="changeset://org-1/demo/CS-1/src/main.ts"
        ariaLabel="Source editor"
        rows={32}
        editorStyle={{ minHeight: 400 }}
        languageId="typescript"
        value="const value = 1"
        onChange={() => undefined}
        readOnly={false}
        activeLine={3}
      />,
    );
    expect(html).toContain('data-editor-adapter="textarea"');
    expect(html).toContain('data-editor-path="src/main.ts"');
    expect(html).toContain('data-editor-model-key="changeset://org-1/demo/CS-1/src/main.ts"');
    expect(html).toContain('aria-label="Source editor"');
    expect(html).toContain('rows="32"');
    expect(html).toContain("min-height:400px");
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

  it("publishes a controller that focuses and positions a requested line", () => {
    const onReady = vi.fn<(controller: EditorController | null) => void>();
    const { unmount } = render(
      <TextAreaEditorAdapter path="src/main.ts" languageId="typescript"
        value={"first\nsecond\nthird"} onChange={() => undefined} readOnly={false} onReady={onReady} />,
    );
    const controller = onReady.mock.calls[0]?.[0];
    expect(controller).toBeTruthy();
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    const focus = vi.spyOn(editor, "focus");
    controller?.focusLine(2, "first\nsecond\nthird");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(editor.selectionStart).toBe(6);
    expect(editor.selectionEnd).toBe(6);
    unmount();
    expect(onReady).toHaveBeenLastCalledWith(null);
  });

  it("keeps advanced language-service capabilities optional for lightweight adapters", () => {
    const controller: EditorController = {
      focusLine: () => undefined,
    };
    expect(controller.revealLine).toBeUndefined();
    expect(controller.setDiagnostics).toBeUndefined();
    expect(controller.executeCommand).toBeUndefined();
    expect(controller.formatDocument).toBeUndefined();
    expect(controller.dispose).toBeUndefined();
  });
});
