import { useEffect, useRef, type ComponentType } from "react";
import { TextArea } from "../ui";

export type EditorController = {
  focusLine: (oneBasedLine: number, content: string) => void;
};

export type EditorAdapterProps = {
  path: string;
  languageId: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  activeLine?: number;
  onReady?: (controller: EditorController | null) => void;
};

export type EditorAdapter = ComponentType<EditorAdapterProps>;

/**
 * Transitional textarea adapter. The page owns persistence and navigation;
 * adapters own editor-specific focus, selection, and scrolling behavior.
 */
export function TextAreaEditorAdapter({
  path,
  languageId,
  value,
  onChange,
  readOnly,
  activeLine = 0,
  onReady,
}: EditorAdapterProps) {
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
    <div
      className="webide-editor-adapter"
      data-editor-adapter="textarea"
      data-editor-path={path}
      data-editor-language={languageId}
      data-active-line={activeLine || undefined}
    >
      <TextArea
        ref={textareaRef}
        aria-label="File content"
        value={value}
        onChange={event => onChange(event.target.value)}
        rows={24}
        disabled={readOnly}
      />
    </div>
  );
}
