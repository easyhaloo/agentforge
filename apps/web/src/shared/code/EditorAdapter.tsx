import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { TextArea } from "../ui";

export type EditorAdapterProps = {
  path: string;
  languageId: string;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  activeLine?: number;
};

export type EditorAdapter = ComponentType<EditorAdapterProps>;

/**
 * Transitional adapter for the current textarea editor.
 *
 * WebIDE owns the editing lifecycle and save boundary; an editor implementation
 * only receives a controlled buffer and emits text changes. Monaco can replace
 * this adapter without taking ownership of Changeset persistence or navigation.
 */
export function TextAreaEditorAdapter({
  path,
  languageId,
  value,
  onChange,
  readOnly,
  activeLine = 0,
}: EditorAdapterProps) {
  const { t } = useTranslation("common");
  return (
    <div
      className="webide-editor-adapter"
      data-editor-adapter="textarea"
      data-editor-path={path}
      data-editor-language={languageId}
      data-active-line={activeLine || undefined}
    >
      <TextArea
        aria-label={t("common:components.fileContentAriaLabel")}
        value={value}
        onChange={event => onChange(event.target.value)}
        rows={24}
        disabled={readOnly}
      />
    </div>
  );
}
