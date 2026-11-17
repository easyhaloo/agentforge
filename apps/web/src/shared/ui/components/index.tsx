import {
  forwardRef,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type FormHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TableHTMLAttributes,
} from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: "small" | "middle" | "large";
}

export function Button({
  variant = "secondary",
  loading = false,
  size = "middle",
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`af-button af-button--${variant} af-button--${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="af-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  controlSize?: "small" | "middle" | "large";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, controlSize = "middle", id, className = "", ...props },
  ref,
) {
  const inputId = id ?? props.name;
  return (
    <label className="af-field" htmlFor={inputId}>
      {label && <span className="af-field__label">{label}</span>}
      <input
        {...props}
        ref={ref}
        id={inputId}
        className={`af-input af-input--${controlSize} ${error ? "af-input--error" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
      />
      {error ? <span className="af-field__error" id={`${inputId}-error`}>{error}</span> : hint ? <span className="af-field__hint" id={`${inputId}-hint`}>{hint}</span> : null}
    </label>
  );
});

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  options: SelectOption[];
  controlSize?: "small" | "middle" | "large";
  placeholder?: string;
}
export function Select({ label, options, controlSize = "middle", placeholder, id, className = "", ...props }: SelectProps) {
  const selectId = id ?? props.name;
  return (
    <label className="af-field" htmlFor={selectId}>
      {label && <span className="af-field__label">{label}</span>}
      <select {...props} id={selectId} className={`af-select af-select--${controlSize} ${className}`.trim()}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
    </label>
  );
}

export interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: string;
  controlSize?: "small" | "middle" | "large";
}
export function DatePicker({ label, controlSize = "middle", id, className = "", ...props }: DatePickerProps) {
  const inputId = id ?? props.name;
  return (
    <label className="af-field" htmlFor={inputId}>
      {label && <span className="af-field__label">{label}</span>}
      <input {...props} id={inputId} type="date" className={`af-input af-input--${controlSize} ${className}`.trim()} />
    </label>
  );
}

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  disabled?: boolean;
  className?: string;
}
export function SearchInput({
  value,
  onChange,
  onSearch,
  placeholder = "Search...",
  debounceMs = 300,
  disabled = false,
  className = "",
}: SearchInputProps) {
  useEffect(() => {
    const handle = window.setTimeout(() => onSearch(value.trim()), debounceMs);
    return () => window.clearTimeout(handle);
  }, [value, debounceMs, onSearch]);

  return (
    <div className={`af-search ${className}`.trim()}>
      <span aria-hidden="true" className="af-search__icon">⌕</span>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSearch(value.trim());
        }}
      />
      {value && <button type="button" aria-label="Clear search" onClick={() => { onChange(""); onSearch(""); }}>×</button>}
    </div>
  );
}

export interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onOk?: () => void | Promise<void>;
  okText?: string;
  cancelText?: string;
  confirmLoading?: boolean;
  closeOnBackdrop?: boolean;
  width?: number | string;
}
export function Modal({
  open,
  title,
  children,
  onCancel,
  onOk,
  okText = "Confirm",
  cancelText = "Cancel",
  confirmLoading = false,
  closeOnBackdrop = true,
  width = 520,
}: ModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || confirmLoading;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  useEffect(() => {
    if (!open) setSubmitting(false);
  }, [open]);

  if (!open) return null;

  const handleOk = async () => {
    if (!onOk || busy) return;
    try {
      setSubmitting(true);
      await onOk();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="af-modal-backdrop" onMouseDown={(event) => {
      if (closeOnBackdrop && event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className="af-modal" role="dialog" aria-modal="true" aria-labelledby="af-modal-title" style={{ width }}>
        <header className="af-modal__header">
          <h2 id="af-modal-title">{title}</h2>
          <button type="button" className="af-modal__close" aria-label="Close dialog" onClick={onCancel} disabled={busy}>×</button>
        </header>
        <div className="af-modal__body">{children}</div>
        <footer className="af-modal__footer">
          <Button onClick={onCancel} disabled={busy}>{cancelText}</Button>
          {onOk && <Button variant="primary" onClick={handleOk} loading={busy}>{okText}</Button>}
        </footer>
      </section>
    </div>
  );
}

export interface FormProps extends FormHTMLAttributes<HTMLFormElement> {
  children: ReactNode;
}
export function Form({ children, className = "", ...props }: FormProps) {
  return <form {...props} className={`af-form ${className}`.trim()}>{children}</form>;
}
export function FormItem({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`af-form-item ${className}`.trim()}>{children}</div>;
}

export interface DataTableColumn<T> {
  key: keyof T | string;
  title: string;
  width?: number | string;
  render?: (value: unknown, row: T, index: number) => ReactNode;
}
export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
}
export interface DataTableProps<T> extends Omit<TableHTMLAttributes<HTMLTableElement>, "children"> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: keyof T | ((row: T) => string | number);
  loading?: boolean;
  emptyText?: string;
  pagination?: DataTablePagination;
  onPageChange?: (page: number, pageSize: number) => void;
}
export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyText = "No data",
  pagination,
  onPageChange,
  className = "",
  ...tableProps
}: DataTableProps<T>) {
  const getRowKey = (row: T) => typeof rowKey === "function" ? rowKey(row) : String(row[rowKey]);
  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const visiblePages = useMemo(() => {
    if (!pagination) return [];
    const start = Math.max(1, Math.min(pagination.page - 2, pageCount - 4));
    return Array.from({ length: Math.min(5, pageCount) }, (_, index) => start + index);
  }, [pagination, pageCount]);

  return (
    <div className="af-table-wrap">
      <table {...tableProps} className={`af-table ${className}`.trim()}>
        <thead><tr>{columns.map((column) => <th key={String(column.key)} style={{ width: column.width }}>{column.title}</th>)}</tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={columns.length} className="af-table__state">Loading…</td></tr> :
            data.length === 0 ? <tr><td colSpan={columns.length} className="af-table__state">{emptyText}</td></tr> :
              data.map((row, index) => <tr key={getRowKey(row)}>{columns.map((column) => {
                const value = (row as Record<string, unknown>)[String(column.key)];
                return <td key={String(column.key)}>{column.render ? column.render(value, row, index) : String(value ?? "—")}</td>;
              })}</tr>)}
        </tbody>
      </table>
      {pagination && (
        <div className="af-pagination">
          <span>{pagination.total} items</span>
          <div className="af-pagination__actions">
            <button type="button" disabled={pagination.page <= 1} onClick={() => onPageChange?.(pagination.page - 1, pagination.pageSize)}>Previous</button>
            {visiblePages.map((page) => <button type="button" key={page} className={page === pagination.page ? "is-active" : ""} onClick={() => onPageChange?.(page, pagination.pageSize)}>{page}</button>)}
            <button type="button" disabled={pagination.page >= pageCount} onClick={() => onPageChange?.(pagination.page + 1, pagination.pageSize)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DateRangePicker({
  start,
  end,
  onChange,
  startLabel = "Start date",
  endLabel = "End date",
}: {
  start: string;
  end: string;
  onChange: (range: { start: string; end: string }) => void;
  startLabel?: string;
  endLabel?: string;
}) {
  return (
    <div className="af-date-range">
      <DatePicker aria-label={startLabel} value={start} max={end || undefined} onChange={(event) => onChange({ start: event.target.value, end })} />
      <span>—</span>
      <DatePicker aria-label={endLabel} value={end} min={start || undefined} onChange={(event) => onChange({ start, end: event.target.value })} />
    </div>
  );
}
