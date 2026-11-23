import { useTranslation } from "react-i18next";
import { Button, Checkbox, Input, Popover, Select, TextArea } from "../../shared/ui";
import { IssueMarkdown } from "./IssueMarkdown";
import type { IssueFormField, IssueFormValues } from "./issueTemplates";

interface Props {
  fields: IssueFormField[];
  values: IssueFormValues;
  invalid: number[];
  disabled: boolean;
  organizationID: string;
  handle: string;
  repository: string;
  onChange: (index: number, values: string[]) => void;
  onAttach: (files: File[], index: number) => void;
}

export function IssueFormFields({ fields, values, invalid, disabled, organizationID, handle, repository, onChange, onAttach }: Props) {
  const { t } = useTranslation("repositories");
  const render = (content: string) => <IssueMarkdown content={content} organizationID={organizationID} handle={handle} repository={repository} />;
  return <div className="issue-form-fields">
    {fields.map((field, index) => {
      const id = `issue-form-field-${index}`;
      if (field.type === "markdown") return <div key={id}>{render(field.value)}</div>;
      const answers = values[index] ?? [];
      const missing = invalid.includes(index);
      const description = field.description ? `${id}-description` : undefined;
      const fieldValidity = {
        "aria-invalid": missing || undefined,
        "aria-describedby": [description, missing ? "issue-form-required" : undefined].filter(Boolean).join(" ") || undefined,
      };
      const label = <>{field.label}{field.required && <span aria-hidden="true"> *</span>}</>;
      const textProps = { id, disabled, maxLength: 65536, "aria-required": field.required, ...fieldValidity };
      const multiple = field.type === "dropdown" && field.multiple;
      const grouped = field.type === "checkboxes" || multiple;
      const groupLabel = `${id}-label`;
      const upload = (files: File[]) => {
        if (!disabled && files.length) onAttach(files, index);
      };
      return <div className="issue-form-field" key={id} role={grouped ? "group" : undefined}
        id={grouped ? id : undefined} tabIndex={grouped ? -1 : undefined}
        aria-labelledby={grouped ? groupLabel : undefined} {...(grouped ? fieldValidity : {})}>
        {grouped ? <span id={groupLabel}>{label}</span> : <label htmlFor={id}>{label}</label>}
        {field.description && <div id={description}>{render(field.description)}</div>}
        {field.type === "input" && <Input {...textProps} value={answers[0] ?? ""} placeholder={field.placeholder}
          onChange={(event) => onChange(index, [event.target.value])} />}
        {field.type === "textarea" && <TextArea {...textProps} value={answers[0] ?? ""} placeholder={field.placeholder}
          onChange={(event) => onChange(index, [event.target.value])} />}
        {field.type === "dropdown" && (field.multiple ? <fieldset disabled={disabled} className="issue-form-multiple">
          <Popover ariaLabel={field.label} trigger={answers.join(", ") || t("issues.templates.selectOption")}>
            {field.options.map((option) => <Checkbox key={option} label={option} checked={answers.includes(option)}
              onChange={(event) => {
                const selected = new Set(answers);
                if (event.target.checked) selected.add(option);
                else selected.delete(option);
                onChange(index, field.options.filter((item) => selected.has(item)));
              }} />)}
          </Popover>
        </fieldset> : <Select id={id} aria-label={field.label} required={field.required} disabled={disabled} {...fieldValidity}
          options={field.options.map((option) => ({ label: option, value: option }))}
          placeholder={t("issues.templates.selectOption")} value={answers[0] ?? ""}
          onChange={(event) => onChange(index, event.target.value ? [event.target.value] : [])} />)}
        {field.type === "checkboxes" && field.options.map((option, position) => {
          const value = String(position);
          return <Checkbox key={value} id={`${id}-${position}`} label={option.label} disabled={disabled}
            checked={answers.includes(value)} aria-required={option.required}
            onChange={(event) => onChange(index, event.target.checked ? [...answers, value] : answers.filter((answer) => answer !== value))} />;
        })}
        {field.type === "upload" && <div className="issue-form-upload"
          onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); upload(Array.from(event.dataTransfer.files)); }}>
          <Input id={id} type="file" accept={field.accept || undefined} multiple disabled={disabled} aria-required={field.required}
            {...fieldValidity} onChange={(event) => {
              upload(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }} />
          {answers.map((answer, position) => <div className="issue-form-upload__file" key={answer}>
            {render(answer)}
            <Button type="button" variant="ghost" size="small" disabled={disabled}
              onClick={() => onChange(index, answers.filter((_, other) => other !== position))}>{t("issues.templates.removeFile")}</Button>
          </div>)}
        </div>}
      </div>;
    })}
  </div>;
}
