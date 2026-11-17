import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
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
      type={props.type ?? "button"}
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
  const generatedId = useId();
  const inputId = id ?? props.name ?? generatedId;
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
  const generatedId = useId();
  const selectId = id ?? props.name ?? generatedId;
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
  const generatedId = useId();
  const inputId = id ?? props.name ?? generatedId;
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
  const onSearchRef = useRef(onSearch);
  const timerRef = useRef<number | undefined>(undefined);
  const initialRender = useRef(true);
  const skipDebounceValue = useRef<string | null>(null);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    if (skipDebounceValue.current === value) {
      skipDebounceValue.current = null;
      return;
    }
    skipDebounceValue.current = null;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => onSearchRef.current(value.trim()), debounceMs);
    return () => window.clearTimeout(timerRef.current);
  }, [value, debounceMs]);

  const submitImmediately = () => {
    window.clearTimeout(timerRef.current);
    skipDebounceValue.current = value;
    onSearchRef.current(value.trim());
  };

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
          if (event.key === "Enter") submitImmediately();
        }}
      />
      {value && <button type="button" aria-label="Clear search" onClick={() => { skipDebounceValue.current = ""; onChange(""); window.clearTimeout(timerRef.current); onSearchRef.current(""); }}>×</button>}
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
  const [submitError, setSubmitError] = useState("");
  const busy = submitting || confirmLoading;
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  busyRef.current = busy;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSubmitting(false);
      setSubmitError("");
    }
  }, [open]);

  if (!open) return null;

  const handleOk = async () => {
    if (!onOk || busy) return;
    setSubmitError("");
    try {
      setSubmitting(true);
      await onOk();
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Unable to complete this action");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="af-modal-backdrop" onMouseDown={(event) => {
      if (closeOnBackdrop && event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="af-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width }}>
        <header className="af-modal__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="af-modal__close" aria-label="Close dialog" onClick={onCancel} disabled={busy}>×</button>
        </header>
        <div className="af-modal__body">
          {children}
          {submitError && <p className="af-modal__error" role="alert">{submitError}</p>}
        </div>
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

export interface DataTableFilterOption {
  label: string;
  value: string;
}
export interface DataTableColumn<T> {
  key: keyof T | string;
  title: string;
  width?: number | string;
  render?: (value: unknown, row: T, index: number) => ReactNode;
  sortable?: boolean;
  filterOptions?: DataTableFilterOption[];
  filterPlaceholder?: string;
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
  selectedRowKeys?: Array<string | number>;
  onSelectionChange?: (keys: Array<string | number>, rows: T[]) => void;
  onSort?: (key: string, direction: "asc" | "desc" | null) => void;
  sortMode?: "client" | "server";
  filterMode?: "client" | "server";
  filters?: Record<string, string>;
  onFilterChange?: (filters: Record<string, string>) => void;
  visibleColumnKeys?: string[];
  onVisibleColumnsChange?: (keys: string[]) => void;
  bulkActions?: ReactNode;
  showColumnVisibility?: boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
}
export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyText = "No data",
  pagination,
  onPageChange,
  selectedRowKeys,
  onSelectionChange,
  onSort,
  sortMode = "client",
  filterMode = "client",
  filters,
  onFilterChange,
  visibleColumnKeys,
  onVisibleColumnsChange,
  bulkActions,
  showColumnVisibility = true,
  onRowClick,
  rowClassName,
  className = "",
  ...tableProps
}: DataTableProps<T>) {
  const getRowKey = (row: T) => typeof rowKey === "function" ? rowKey(row) : String(row[rowKey]);
  const [internalSelected, setInternalSelected] = useState<Array<string | number>>([]);
  const [sortState, setSortState] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [internalFilters, setInternalFilters] = useState<Record<string, string>>({});
  const [internalVisibleKeys, setInternalVisibleKeys] = useState<string[]>(() => columns.map((column) => String(column.key)));
  const selected = selectedRowKeys ?? internalSelected;
  const activeFilters = filters ?? internalFilters;
  const visibleKeys = visibleColumnKeys ?? internalVisibleKeys;
  const visibleColumns = columns.filter((column) => visibleKeys.includes(String(column.key)));
  const hasActiveFilters = Object.values(activeFilters).some(Boolean);
  const setFilters = (next: Record<string, string>) => {
    if (filters === undefined) setInternalFilters(next);
    onFilterChange?.(next);
  };
  const setVisibleKeys = (next: string[]) => {
    if (visibleColumnKeys === undefined) setInternalVisibleKeys(next);
    onVisibleColumnsChange?.(next);
  };
  const toggleRow = (key: string | number, checked: boolean) => {
    const next = checked ? [...selected, key] : selected.filter((item) => item !== key);
    if (selectedRowKeys === undefined) setInternalSelected(next);
    onSelectionChange?.(next, data.filter((row) => next.includes(getRowKey(row))));
  };
  const toggleAll = (checked: boolean) => {
    const pageKeys = data.map(getRowKey);
    const keys = checked
      ? Array.from(new Set([...selected, ...pageKeys]))
      : selected.filter((key) => !pageKeys.includes(key));
    if (selectedRowKeys === undefined) setInternalSelected(keys);
    onSelectionChange?.(keys, data.filter((row) => keys.includes(getRowKey(row))));
  };
  const filteredData = useMemo(() => {
    if (filterMode === "server") return data;
    return data.filter((row) => columns.every((column) => {
      const filterValue = activeFilters[String(column.key)];
      if (!filterValue) return true;
      const value = (row as unknown as Record<string, unknown>)[String(column.key)];
      return String(value ?? "") === filterValue;
    }));
  }, [data, columns, activeFilters, filterMode]);
  const sortedData = useMemo(() => {
    if (!sortState || sortMode === "server") return filteredData;
    const column = columns.find((item) => String(item.key) === sortState.key);
    if (!column) return filteredData;
    return [...filteredData].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortState.key];
      const bv = (b as unknown as Record<string, unknown>)[sortState.key];
      const result = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
      return sortState.direction === "asc" ? result : -result;
    });
  }, [filteredData, columns, sortState, sortMode]);
  const changeSort = (key: string) => {
    const direction = sortState?.key !== key ? "asc" : sortState.direction === "asc" ? "desc" : null;
    setSortState(direction ? { key, direction } : null);
    onSort?.(key, direction);
  };
  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const visiblePages = useMemo(() => {
    if (!pagination) return [];
    const start = Math.max(1, Math.min(pagination.page - 2, pageCount - 4));
    return Array.from({ length: Math.min(5, pageCount) }, (_, index) => start + index);
  }, [pagination, pageCount]);
  const selectionColumnCount = onSelectionChange ? 1 : 0;
  const emptyColumnCount = Math.max(1, visibleColumns.length + selectionColumnCount);

  return (
    <div className="af-table-wrap">
      {(showColumnVisibility || bulkActions || hasActiveFilters || onFilterChange) && (
        <div className="af-table-toolbar">
          <div className="af-table-toolbar__start">
            {onSelectionChange && <span className="af-table-toolbar__selection">{selected.length} selected</span>}
            {bulkActions && selected.length > 0 && <div className="af-table-toolbar__bulk">{bulkActions}</div>}
          </div>
          {showColumnVisibility && (
            <details className="af-table-columns">
              <summary>Columns</summary>
              <div className="af-table-columns__menu">
                {columns.map((column) => {
                  const key = String(column.key);
                  return <label key={key}><input type="checkbox" checked={visibleKeys.includes(key)} disabled={visibleKeys.length === 1 && visibleKeys.includes(key)} onChange={(event) => setVisibleKeys(event.target.checked ? [...visibleKeys, key] : visibleKeys.filter((item) => item !== key))} />{column.title}</label>;
                })}
              </div>
            </details>
          )}
        </div>
      )}
      <table {...tableProps} className={`af-table ${className}`.trim()}>
        <thead>
          <tr>
            {onSelectionChange && <th className="af-table__selection"><input type="checkbox" aria-label="Select all rows on this page" checked={data.length > 0 && data.every((row) => selected.includes(getRowKey(row)))} onChange={(event) => toggleAll(event.target.checked)} /></th>}
            {visibleColumns.map((column) => <th key={String(column.key)} style={{ width: column.width }}>
              {column.sortable ? <button type="button" className="af-table__sort" onClick={() => changeSort(String(column.key))}>{column.title}<span aria-hidden="true">{sortState?.key === String(column.key) ? sortState.direction === "asc" ? " ↑" : " ↓" : " ↕"}</span></button> : column.title}
            </th>)}
          </tr>
          {columns.some((column) => column.filterOptions?.length) && (
            <tr className="af-table__filters">
              {onSelectionChange && <th />}
              {visibleColumns.map((column) => <th key={String(column.key)}>
                {column.filterOptions?.length ? (
                  <select aria-label={`Filter ${column.title}`} value={activeFilters[String(column.key)] ?? ""} onChange={(event) => setFilters({ ...activeFilters, [String(column.key)]: event.target.value })}>
                    <option value="">{column.filterPlaceholder ?? "All"}</option>
                    {column.filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : null}
              </th>)}
            </tr>
          )}
        </thead>
        <tbody>
          {loading ? <tr><td colSpan={emptyColumnCount} className="af-table__state">Loading…</td></tr> :
            sortedData.length === 0 ? <tr><td colSpan={emptyColumnCount} className="af-table__state">{emptyText}</td></tr> :
              sortedData.map((row, index) => <tr key={getRowKey(row)} className={rowClassName?.(row)} tabIndex={onRowClick ? 0 : undefined} aria-label={onRowClick ? "Open row" : undefined} onClick={(event) => { if (!onRowClick) return; const target = event.target; if (target instanceof HTMLElement && target.closest("button, a, input, select, textarea, [role='button']")) return; onRowClick(row); }} onKeyDown={(event) => { if (!onRowClick || event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRowClick(row); } }}>{onSelectionChange && <td className="af-table__selection"><input type="checkbox" aria-label={`Select row ${String(getRowKey(row))}`} checked={selected.includes(getRowKey(row))} onChange={(event) => toggleRow(getRowKey(row), event.target.checked)} /></td>}{visibleColumns.map((column) => {
                const value = (row as unknown as Record<string, unknown>)[String(column.key)];
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


export interface DrawerProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number | string;
  placement?: "left" | "right";
}
export function Drawer({ open, title, children, onClose, width = 480, placement = "right" }: DrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = drawerRef.current;
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        drawer?.focus();
      } else if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
        event.preventDefault();
        items[0].focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="af-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}>
      <aside ref={drawerRef} tabIndex={-1} className={`af-drawer af-drawer--${placement}`} role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <header className="af-drawer__header"><h2>{title}</h2><button type="button" aria-label="Close drawer" onClick={() => onCloseRef.current()}>×</button></header>
        <div className="af-drawer__body">{children}</div>
      </aside>
    </div>
  );
}

export function ConfirmDialog({
  open, title = "Are you sure?", description, confirmText = "Confirm", danger = false, onCancel, onConfirm,
}: {
  open: boolean; title?: string; description: ReactNode; confirmText?: string; danger?: boolean;
  onCancel: () => void; onConfirm: () => void | Promise<void>;
}) {
  return (
    <Modal open={open} title={title} onCancel={onCancel} onOk={onConfirm} okText={confirmText}>
      <p className="af-confirm-description">{description}</p>
      {danger && <p className="af-confirm-warning">This action cannot be undone.</p>}
    </Modal>
  );
}

export function Popover({ trigger, children, placement = "bottom" }: {
  trigger: ReactNode; children: ReactNode; placement?: "bottom" | "top";
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="af-popover">
      <button type="button" className="af-popover__trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{trigger}</button>
      {open && <div className={`af-popover__content af-popover__content--${placement}`} role="dialog">{children}</div>}
    </div>
  );
}

export interface AsyncSelectOption { label: string; value: string; }
export function AsyncSelect({ value, onChange, loadOptions, placeholder = "Search options...", debounceMs = 250, disabled = false }: {
  value?: string; onChange: (value: string, option?: AsyncSelectOption) => void;
  loadOptions: (keyword: string, signal: AbortSignal) => Promise<AsyncSelectOption[]>;
  placeholder?: string; debounceMs?: number; disabled?: boolean;
}) {
  const [keyword, setKeyword] = useState("");
  const [options, setOptions] = useState<AsyncSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const result = await loadOptions(keyword.trim(), controller.signal);
        if (!controller.signal.aborted) setOptions(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load options");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, debounceMs);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [keyword, open, debounceMs, loadOptions]);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="af-async-select">
      <button type="button" className="af-select af-async-select__control" disabled={disabled} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {selected?.label ?? value ?? placeholder}<span>⌄</span>
      </button>
      {open && <div className="af-async-select__menu">
        <input autoFocus value={keyword} placeholder={placeholder} onChange={(event) => setKeyword(event.target.value)} />
        {loading ? <div className="af-async-select__state">Loading…</div> : error ? <div className="af-async-select__state af-field__error">{error}</div> : options.length ? options.map((option) => <button type="button" key={option.value} onClick={() => { onChange(option.value, option); setOpen(false); setKeyword(""); }}>{option.label}</button>) : <div className="af-async-select__state">No options</div>}
      </div>}
    </div>
  );
}
