import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonacoEditorAdapter } from "./MonacoEditorAdapter";
import type { EditorController } from "./EditorAdapter";

const mocks = vi.hoisted(() => ({
  createModel: vi.fn(),
  createEditor: vi.fn(),
  setModelLanguage: vi.fn(),
  setModelMarkers: vi.fn(),
  configureWorkers: vi.fn(),
  modelDispose: vi.fn(),
  editorDispose: vi.fn(),
  updateOptions: vi.fn(),
  focus: vi.fn(),
  revealLineInCenter: vi.fn(),
  setPosition: vi.fn(),
  getPosition: vi.fn(),
  actionRun: vi.fn(),
}));

vi.mock("./monacoWorkers", () => ({
  configureMonacoWorkers: mocks.configureWorkers,
}));

vi.mock("monaco-editor", () => ({
  Uri: { parse: (value: string) => value },
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  editor: {
    createModel: mocks.createModel,
    create: mocks.createEditor,
    setModelLanguage: mocks.setModelLanguage,
    setModelMarkers: mocks.setModelMarkers,
  },
}));

function makeModel(initialValue: string, languageId: string) {
  let value = initialValue;
  let listener: (() => void) | undefined;
  return {
    getValue: () => value,
    setValue: (next: string) => { value = next; listener?.(); },
    getLineCount: () => value.split("\n").length,
    getLanguageId: () => languageId,
    onDidChangeContent: (callback: () => void) => {
      listener = callback;
      return { dispose: vi.fn(() => { listener = undefined; }) };
    },
    dispose: mocks.modelDispose,
  };
}

function makeEditor() {
  return {
    updateOptions: mocks.updateOptions,
    dispose: mocks.editorDispose,
    focus: mocks.focus,
    revealLineInCenter: mocks.revealLineInCenter,
    setPosition: mocks.setPosition,
    getPosition: mocks.getPosition,
    getAction: () => ({ run: mocks.actionRun }),
  };
}

const baseProps = {
  path: "src/main.ts",
  modelKey: "changeset://org/repo/CS-1/src/main.ts",
  languageId: "typescript",
  value: "first\nsecond",
  onChange: vi.fn(),
  readOnly: false,
};

describe("MonacoEditorAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createModel.mockImplementation((value: string, language: string) => makeModel(value, language));
    mocks.createEditor.mockImplementation(() => makeEditor());
    mocks.getPosition.mockReturnValue({ lineNumber: 2, column: 3 });
    mocks.actionRun.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("creates a Monaco model and editor, exposes controller capabilities, and disposes both", async () => {
    const onReady = vi.fn<(controller: EditorController | null) => void>();
    const view = render(<MonacoEditorAdapter {...baseProps} readOnly onReady={onReady} />);

    await waitFor(() => expect(mocks.createEditor).toHaveBeenCalledTimes(1));
    expect(mocks.createModel).toHaveBeenCalledWith(
      "first\nsecond",
      "typescript",
      "changeset://org/repo/CS-1/src/main.ts",
    );
    expect(mocks.createEditor.mock.calls[0]?.[1]).toMatchObject({ readOnly: true, minimap: { enabled: false } });

    const controller = onReady.mock.calls.find(([value]) => value !== null)?.[0];
    expect(controller).toBeTruthy();
    controller?.focusLine(2, baseProps.value);
    expect(mocks.revealLineInCenter).toHaveBeenCalledWith(2);
    expect(controller?.getPosition?.()).toEqual({ lineNumber: 2, column: 3 });
    controller?.setDiagnostics?.([{
      message: "Unexpected token",
      severity: "error",
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 2,
      source: "typescript",
    }]);
    expect(mocks.setModelMarkers).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("agentforge-webide-"), [
      expect.objectContaining({ message: "Unexpected token", severity: 8 }),
    ]);
    expect(controller?.executeCommand?.("editor.action.formatDocument")).toBe(true);
    await expect(controller?.formatDocument?.()).resolves.toBe(baseProps.value);

    view.rerender(<MonacoEditorAdapter {...baseProps} readOnly={false} onReady={onReady} />);
    await waitFor(() => expect(mocks.updateOptions).toHaveBeenCalledWith({ readOnly: false }));
    view.unmount();

    expect(mocks.editorDispose).toHaveBeenCalledTimes(1);
    expect(mocks.modelDispose).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenLastCalledWith(null);
  });

  it("propagates Monaco model edits to the controlled React callback", async () => {
    const onChange = vi.fn();
    render(<MonacoEditorAdapter {...baseProps} onChange={onChange} />);
    await waitFor(() => expect(mocks.createModel).toHaveBeenCalledTimes(1));

    const model = mocks.createModel.mock.results[0]?.value as ReturnType<typeof makeModel>;
    model.setValue("updated\ncontent");
    expect(onChange).toHaveBeenCalledWith("updated\ncontent");
  });
});
