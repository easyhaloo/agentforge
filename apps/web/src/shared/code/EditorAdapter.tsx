import { useEffect, useRef, type ComponentType, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { TextArea } from "../ui";

export type EditorDiagnosticSeverity = "error" | "warning" | "info" | "hint";

export type EditorDiagnostic = {
  message: string;
  severity: EditorDiagnosticSeverity;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  source?: string;
  code?: string;
};

export type EditorCommand = {
  id: string;
  label: string;
  keybinding?: string;
};

export type EditorPosition = {
  lineNumber: number;
  column: number;
};

/**
 * Stable AgentForge-facing editor surface. Optional methods are capabilities:
 * a lightweight adapter may omit them, while Monaco can implement them without
 * exposing Monaco models, disposables, or editor instances to the page.
 */
export type EditorController = {
  focusLine: (oneBasedLine: number, content: string) => void;
  revealLine?: (oneBasedLine: number) => void;
  getPosition?: () => EditorPosition | null;
  setDiagnostics?: (diagnostics: readonly EditorDiagnostic[]) => void;
  executeCommand?: (commandId: string) => boolean;
  formatDocument?: () => Promise<string | null>;
  dispose?: () => void;
};

export type EditorAdapterProps = {
  path: string;
  languageId: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  activeLine?: number;
  ariaLabel?: string;
  rows?: number;
  editorStyle?: CSSProperties;
  onReady?: (controller: EditorController | null) => void;
};

export type EditorAdapter = ComponentType<EditorAdapterProps>;

/** Transitional textarea adapter. WebIDE owns persistence; adapters own editor navigation. */
export function TextAreaEditorAdapter({
  path, languageId, value, onChange, readOnly, activeLine = 0, ariaLabel, rows = 24, editorStyle, onReady,
}: EditorAdapterProps) {
  const { t } = useTranslation("common");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller: EditorController = {
      focusLine(oneBasedLine, content) {
        const editor = textareaRef.current;
        if (!editor || oneBasedLine < 1) return;
        const lines = content.split("\n");
        const targetLine = Math.min(lines.length, Math.max(1, Math.floor(oneBasedLine)));
        const offset = lines.slice(0, targetLine - 1).reduce((total, line) => total + line.length + 1, 0);
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(offset, offset);
        const lineHeight = Number.parseFloat(window.getComputedStyle(editor).lineHeight);
        if (Number.isFinite(lineHeight)) editor.scrollTop = Math.max(0, (targetLine - 1) * lineHeight);
      },
    };
    onReady?.(controller);
    return () => onReady?.(null);
  }, [onReady]);

  return (
    <div className="webide-editor-adapter" data-editor-adapter="textarea" data-editor-path={path}
      data-editor-language={languageId} data-active-line={activeLine || undefined}>
      <TextArea ref={textareaRef} aria-label={ariaLabel ?? t("common:components.fileContentAriaLabel")}
        spellCheck={false} value={value} onChange={event => onChange(event.target.value)}
        rows={rows} disabled={readOnly} style={editorStyle} />
    </div>
  );
}
