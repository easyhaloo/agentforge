import { forwardRef, useId, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

type FieldSize = "small" | "middle" | "large";

interface SharedFieldProps {
  label?: string;
  hint?: string;
  error?: string;
  controlSize?: FieldSize;
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size">, SharedFieldProps {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, controlSize = "middle", id, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? props.name ?? generatedId;
  const messageId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <label className="af-field" htmlFor={fieldId}>
      {label && <span className="af-field__label">{label}</span>}
      <textarea
        {...props}
        ref={ref}
        id={fieldId}
        className={`af-textarea af-textarea--${controlSize} ${error ? "af-input--error" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={messageId}
      />
      {error ? <span className="af-field__error" id={messageId}>{error}</span> : hint ? <span className="af-field__hint" id={messageId}>{hint}</span> : null}
    </label>
  );
});

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size">, SharedFieldProps {
  showToggle?: boolean;
  showText?: string;
  hideText?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { label, hint, error, controlSize = "middle", showToggle = true, showText = "Show", hideText = "Hide", id, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? props.name ?? generatedId;
  const [visible, setVisible] = useState(false);
  const messageId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <label className="af-field" htmlFor={fieldId}>
      {label && <span className="af-field__label">{label}</span>}
      <span className="af-password">
        <input
          {...props}
          ref={ref}
          id={fieldId}
          type={visible ? "text" : "password"}
          className={`af-input af-input--${controlSize} ${error ? "af-input--error" : ""} ${className}`.trim()}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={messageId}
        />
        {showToggle && <button type="button" className="af-password__toggle" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>{visible ? hideText : showText}</button>}
      </span>
      {error ? <span className="af-field__error" id={messageId}>{error}</span> : hint ? <span className="af-field__hint" id={messageId}>{hint}</span> : null}
    </label>
  );
});

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size">, SharedFieldProps {}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { label, hint, error, controlSize = "middle", id, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? props.name ?? generatedId;
  const messageId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <label className="af-field" htmlFor={fieldId}>
      {label && <span className="af-field__label">{label}</span>}
      <input
        {...props}
        ref={ref}
        id={fieldId}
        type="number"
        className={`af-input af-input--${controlSize} ${error ? "af-input--error" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={messageId}
      />
      {error ? <span className="af-field__error" id={messageId}>{error}</span> : hint ? <span className="af-field__hint" id={messageId}>{hint}</span> : null}
    </label>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: string;
  hint?: string;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, id, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? props.name ?? generatedId;
  return (
    <div className={`af-choice-field ${className}`.trim()}>
      <label className="af-choice" htmlFor={fieldId}>
        <input {...props} ref={ref} id={fieldId} type="checkbox" aria-invalid={Boolean(error) || undefined} />
        <span>{label}</span>
      </label>
      {error ? <span className="af-field__error">{error}</span> : hint ? <span className="af-field__hint">{hint}</span> : null}
    </div>
  );
});

export function Radio(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return <input {...props} type="radio" />;
}

export interface RadioOption {
  label: string;
  value: string;
  disabled?: boolean;
}
export interface RadioGroupProps {
  label?: string;
  name: string;
  value?: string;
  defaultValue?: string;
  options: RadioOption[];
  onChange?: (value: string) => void;
  direction?: "horizontal" | "vertical";
  disabled?: boolean;
  hint?: string;
  error?: string;
}

export function RadioGroup({
  label, name, value, defaultValue, options, onChange, direction = "vertical", disabled = false, hint, error,
}: RadioGroupProps) {
  const generatedId = useId();
  const groupId = `${name || generatedId}-group`;
  return (
    <fieldset className="af-choice-field" disabled={disabled} aria-describedby={error ? `${groupId}-error` : hint ? `${groupId}-hint` : undefined}>
      {label && <legend className="af-field__label">{label}</legend>}
      <div className={`af-radio-group af-radio-group--${direction}`}>
        {options.map((option, index) => {
          const optionId = `${groupId}-${index}`;
          return (
            <label className="af-choice" htmlFor={optionId} key={option.value}>
              <Radio
                id={optionId}
                name={name}
                value={option.value}
                checked={value === undefined ? undefined : value === option.value}
                defaultChecked={value === undefined && defaultValue === option.value}
                disabled={disabled || option.disabled}
                onChange={() => onChange?.(option.value)}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
      {error ? <span className="af-field__error" id={`${groupId}-error`}>{error}</span> : hint ? <span className="af-field__hint" id={`${groupId}-hint`}>{hint}</span> : null}
    </fieldset>
  );
}

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: string;
  description?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, description, id, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? props.name ?? generatedId;
  return (
    <label className={`af-switch ${className}`.trim()} htmlFor={fieldId}>
      <span className="af-switch__copy"><span className="af-field__label">{label}</span>{description && <span className="af-field__hint">{description}</span>}</span>
      <input {...props} ref={ref} id={fieldId} type="checkbox" role="switch" />
      <span className="af-switch__track" aria-hidden="true"><span /></span>
    </label>
  );
});
