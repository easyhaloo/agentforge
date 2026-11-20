import "monaco-editor/min/vs/editor/editor.main.css";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type * as Monaco from "monaco-editor";
import { useTranslation } from "react-i18next";
import { KeyedResourceRegistry, type ResourceLease } from "./KeyedResourceRegistry";
import { configureMonacoWorkers } from "./monacoWorkers";
import type { EditorAdapterProps, EditorController, EditorDiagnostic } from "./EditorAdapter";

const modelRegistry = new KeyedResourceRegistry<Monaco.editor.ITextModel>();
let markerOwnerSequence = 0;

function toMonacoSeverity(monaco: typeof Monaco, severity: EditorDiagnostic["severity"]) {
  switch (severity) {
    case "error": return monaco.MarkerSeverity.Error;
    case "warning": return monaco.MarkerSeverity.Warning;
    case "info": return monaco.MarkerSeverity.Info;
    case "hint": return monaco.MarkerSeverity.Hint;
  }
}

function editorHeight(rows: number, style?: CSSProperties): CSSProperties {
  return {
    width: "100%",
    minHeight: style?.minHeight ?? Math.max(320, rows * 20),
    height: style?.height ?? Math.max(480, rows * 20),
    ...style,
  };
}

/**
 * Monaco is dynamically imported only when a lazy WebIDE route mounts this adapter.
 * Models are shared by URI and released independently from editor instances.
 */
export function MonacoEditorAdapter({
  path, modelKey, languageId, value, onChange, readOnly, activeLine = 0,
  ariaLabel, rows = 24, editorStyle, onReady,
}: EditorAdapterProps) {
  const { t } = useTranslation("common");
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const latestValueRef = useRef(value);
  const latestReadOnlyRef = useRef(readOnly);
  const [loadError, setLoadError] = useState(false);

  onChangeRef.current = onChange;
  latestValueRef.current = value;
  latestReadOnlyRef.current = readOnly;

  useEffect(() => {
    let cancelled = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
    let lease: ResourceLease<Monaco.editor.ITextModel> | undefined;
    let changeSubscription: Monaco.IDisposable | undefined;
    let controller: EditorController | undefined;
    let markerOwner = "";

    async function mount() {
      try {
        configureMonacoWorkers();
        const monaco = await import("monaco-editor");
        if (cancelled || !hostRef.current) return;

        const identity = modelKey || `file:///${encodeURIComponent(path)}`;
        const uri = monaco.Uri.parse(identity);
        lease = modelRegistry.acquire(identity, () => {
          const model = monaco.editor.createModel(latestValueRef.current, languageId, uri);
          return { value: model, dispose: () => model.dispose() };
        });
        const model = lease.value;
        if (model.getLanguageId() !== languageId) {
          monaco.editor.setModelLanguage(model, languageId);
        }
        if (model.getValue() !== latestValueRef.current) {
          model.setValue(latestValueRef.current);
        }

        editor = monaco.editor.create(hostRef.current, {
          model,
          readOnly: latestReadOnlyRef.current,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "off",
          fontSize: 13,
          lineNumbers: "on",
          renderValidationDecorations: "on",
          accessibilitySupport: "auto",
          ariaLabel: ariaLabel ?? t("components.fileContentAriaLabel"),
          theme: "vs-dark",
          padding: { top: 12, bottom: 12 },
        });

        (hostRef.current as HTMLDivElement & { __monacoEditor?: Monaco.editor.IStandaloneCodeEditor }).__monacoEditor = editor;
        markerOwner = `agentforge-webide-${++markerOwnerSequence}`;
        changeSubscription = model.onDidChangeContent(() => {
          const next = model.getValue();
          if (next !== latestValueRef.current) onChangeRef.current(next);
        });

        controller = {
          focusLine(oneBasedLine) {
            if (!editor || oneBasedLine < 1) return;
            const line = Math.min(model.getLineCount(), Math.floor(oneBasedLine));
            editor.focus();
            editor.revealLineInCenter(line);
            editor.setPosition({ lineNumber: line, column: 1 });
          },
          revealLine(oneBasedLine) {
            if (!editor || oneBasedLine < 1) return;
            editor.revealLineInCenter(Math.min(model.getLineCount(), Math.floor(oneBasedLine)));
          },
          getPosition() {
            const position = editor?.getPosition();
            return position ? { lineNumber: position.lineNumber, column: position.column } : null;
          },
          setDiagnostics(diagnostics: readonly EditorDiagnostic[]) {
            monaco.editor.setModelMarkers(model, markerOwner, diagnostics.map(item => ({
              message: item.message,
              severity: toMonacoSeverity(monaco, item.severity),
              startLineNumber: item.startLineNumber,
              startColumn: item.startColumn,
              endLineNumber: item.endLineNumber,
              endColumn: item.endColumn,
              source: item.source,
              code: item.code,
            })));
          },
          executeCommand(commandId) {
            const action = editor?.getAction(commandId);
            if (!action) return false;
            void action.run();
            return true;
          },
          async formatDocument() {
            const action = editor?.getAction("editor.action.formatDocument");
            if (!action) return null;
            await action.run();
            return model.getValue();
          },
          dispose() {
            monaco.editor.setModelMarkers(model, markerOwner, []);
          },
        };
        if (activeLine > 0) controller.focusLine(activeLine, model.getValue());
        if (!cancelled) onReady?.(controller);
      } catch {
        changeSubscription?.dispose();
        controller?.dispose?.();
        const host = hostRef.current as (HTMLDivElement & { __monacoEditor?: Monaco.editor.IStandaloneCodeEditor }) | null;
        if (host && host.__monacoEditor === editor) delete host.__monacoEditor;
        editor?.dispose();
        lease?.release();
        changeSubscription = undefined;
        controller = undefined;
        editor = undefined;
        lease = undefined;
        if (!cancelled) setLoadError(true);
      }
    }

    void mount();
    return () => {
      cancelled = true;
      onReady?.(null);
      changeSubscription?.dispose();
      controller?.dispose?.();
      const host = hostRef.current as (HTMLDivElement & { __monacoEditor?: Monaco.editor.IStandaloneCodeEditor }) | null;
      if (host && host.__monacoEditor === editor) delete host.__monacoEditor;
      editor?.dispose();
      lease?.release();
    };
  // model identity and initial language define the model lease for this mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, path, languageId]);

  useEffect(() => {
    const host = hostRef.current;
    const editor = host ? (host as HTMLDivElement & { __monacoEditor?: Monaco.editor.IStandaloneCodeEditor }).__monacoEditor : undefined;
    if (editor) editor.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    // React is the authoritative buffer. Avoid setValue when Monaco already has
    // the same text; this preserves cursor position and undo history on keystrokes.
    const host = hostRef.current as (HTMLDivElement & { __monacoEditor?: Monaco.editor.IStandaloneCodeEditor }) | null;
    const model = host?.__monacoEditor?.getModel();
    if (model && model.getValue() !== value) model.setValue(value);
  }, [value]);

  return (
    <div className="webide-editor-adapter" data-editor-adapter="monaco" data-editor-path={path}
      data-editor-language={languageId} data-editor-model-key={modelKey} data-active-line={activeLine || undefined}>
      {loadError ? (
        <div role="alert" className="editor-load-error">{t("components.editorLoadFailed", "The code editor could not be loaded.")}</div>
      ) : null}
      <div ref={hostRef} aria-label={ariaLabel ?? t("components.fileContentAriaLabel")}
        data-testid="monaco-editor-host" style={editorHeight(rows, editorStyle)} />
    </div>
  );
}
