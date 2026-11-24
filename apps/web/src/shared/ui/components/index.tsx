import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FormHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TableHTMLAttributes,
} from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../api/errors";

export function getFocusTrapTargetIndex(
  focusableCount: number,
  activeIndex: number,
  shiftKey: boolean,
  focusIsInside: boolean,
): number | null {
  if (focusableCount <= 0) return null;
  if (!focusIsInside) return shiftKey ? focusableCount - 1 : 0;
  if (shiftKey && activeIndex === 0) return focusableCount - 1;
  if (!shiftKey && activeIndex === focusableCount - 1) return 0;
  return null;
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: "small" | "middle" | "large";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "secondary",
  loading = false,
  size = "middle",
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps, ref) {
  return (
    <button
      {...props}
      ref={ref}
      className={`af-button af-button--${variant} af-button--${size} ${className}`.trim()}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className="af-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: ReactNode;
  controlSize?: "small" | "middle" | "large";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, controlSize = "middle", id, className = "", ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? props.name ?? generatedId;
  const messageId = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <label className="af-field" htmlFor={inputId}>
      {label && <span className="af-field__label">{label}</span>}
      <input
        {...props}
        ref={ref}
        id={inputId}
        className={`af-input af-input--${controlSize} ${error ? "af-input--error" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error) || props["aria-invalid"]}
        aria-describedby={[props["aria-describedby"], messageId].filter(Boolean).join(" ") || undefined}
      />
      {error ? <span className="af-field__error" id={`${inputId}-error`}>{error}</span> : hint ? <span className="af-field__hint" id={`${inputId}-hint`}>{hint}</span> : null}
    </label>
  );
});

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
  icon?: React.ComponentType<{ size?: number }>;
  title?: string;
}
export interface SelectProps extends Pick<React.AriaAttributes, "aria-invalid" | "aria-describedby"> {
  label?: string;
  options: SelectOption[];
  menuTitle?: string;
  controlSize?: "small" | "middle" | "large";
  placeholder?: string;
  hint?: string;
  error?: string;
  id?: string;
  className?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  form?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}
export function Select({ label, options, menuTitle, controlSize = "middle", placeholder, hint, error, id, className = "", value, defaultValue, onChange, disabled, name, required, autoFocus, form, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? name ?? generatedId;
  const messageId = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;
  const [open, setOpen] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? "");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : uncontrolledValue;
  const selectedOption = options.find((opt) => opt.value === currentValue);
  const { t } = useTranslation("common");
  const displayText = selectedOption?.label ?? placeholder ?? t("common:components.selectOption");
  const firstIndex = options.findIndex(option => !option.disabled);
  const initialIndex = selectedOption && !selectedOption.disabled ? options.indexOf(selectedOption) : firstIndex;

  useEffect(() => {
    if (!open) return;
    optionRefs.current[initialIndex]?.focus();
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, initialIndex]);

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const enabled = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? []);
    if (!enabled.length) return;
    event.preventDefault();
    const current = enabled.findIndex(option => option === document.activeElement);
    const last = enabled.length - 1;
    if (event.key === "Home") enabled[0].focus();
    else if (event.key === "End") enabled[last].focus();
    else if (event.key === "ArrowUp") enabled[current <= 0 ? last : current - 1].focus();
    else enabled[current >= last ? 0 : current + 1].focus();
  };

  const handleSelect = (option: SelectOption) => {
    if (option.disabled) return;

    if (!isControlled) {
      setUncontrolledValue(option.value);
    }

    onChange?.({ target: { value: option.value, name } } as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const triggerClasses = [
    "af-select-trigger",
    `af-select-trigger--${controlSize}`,
    error ? "af-select-trigger--error" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className="af-field">
      {label && <label className="af-field__label" htmlFor={selectId}>{label}</label>}
      <div className="af-select" onKeyDown={handleKeyDown} onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}>
        <button
          ref={triggerRef}
          id={selectId}
          type="button"
          role="combobox"
          className={triggerClasses}
          disabled={disabled}
          autoFocus={autoFocus}
          form={form}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy || (label ? undefined : ariaLabel ? undefined : selectId)}
          aria-haspopup="listbox"
          aria-controls={open ? `${selectId}-options` : undefined}
          aria-expanded={open}
          aria-invalid={Boolean(error) || ariaInvalid}
          aria-required={required || undefined}
          aria-describedby={[ariaDescribedBy, messageId].filter(Boolean).join(" ") || undefined}
          onClick={() => setOpen(!open)}
        >
          <span className="af-select-trigger__label">{displayText}</span>
          <span className="af-select-trigger__icon" aria-hidden="true">{open ? "▲" : "▼"}</span>
        </button>
        {open && (
          <div ref={menuRef} className="af-select-dropdown" id={`${selectId}-options`} role="listbox"
            aria-label={menuTitle || ariaLabel} aria-labelledby={menuTitle || ariaLabel ? undefined : selectId}>
            {menuTitle && <div className="af-select-dropdown__title" aria-hidden="true">{menuTitle}</div>}
            {placeholder && (
              <button
                type="button"
                role="option"
                className={`af-select-option ${currentValue === "" ? "af-select-option--selected" : ""}`}
                aria-selected={currentValue === ""}
                onClick={() => handleSelect({ label: placeholder, value: "" })}
              >
                <span>{placeholder}</span>
              </button>
            )}
            {options.map((option, index) => {
              const Icon = option.icon;
              const isSelected = option.value === currentValue;
              return (
                <button
                  key={option.value}
                  ref={(el) => { optionRefs.current[index] = el; }}
                  type="button"
                  role="option"
                  className={`af-select-option ${isSelected ? "af-select-option--selected" : ""}`}
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  title={option.title}
                  onClick={() => handleSelect(option)}
                >
                  {Icon && <Icon size={14} aria-hidden="true" />}
                  <span>{option.label}</span>
                  {isSelected && <span className="af-select-option__check" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {error ? <span className="af-field__error" id={`${selectId}-error`}>{error}</span> : hint ? <span className="af-field__hint" id={`${selectId}-hint`}>{hint}</span> : null}
    </div>
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
  placeholder,
  debounceMs = 300,
  disabled = false,
  className = "",
}: SearchInputProps) {
  const { t } = useTranslation("common");
  const onSearchRef = useRef(onSearch);
  const timerRef = useRef<number | undefined>(undefined);
  const lastSearchValue = useRef(value);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    if (lastSearchValue.current === value) return;
    timerRef.current = window.setTimeout(() => {
      lastSearchValue.current = value;
      onSearchRef.current(value.trim());
    }, debounceMs);
    return () => window.clearTimeout(timerRef.current);
  }, [value, debounceMs]);

  const submitImmediately = () => {
    window.clearTimeout(timerRef.current);
    lastSearchValue.current = value;
    onSearchRef.current(value.trim());
  };

  return (
    <div className={`af-search ${className}`.trim()}>
      <span aria-hidden="true" className="af-search__icon">⌕</span>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? t("common:components.searchPlaceholder")}
        aria-label={placeholder ?? t("common:components.searchPlaceholder")}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submitImmediately();
        }}
      />
      {value && <button type="button" aria-label={t("common:components.clearSearch")} onClick={() => { lastSearchValue.current = ""; onChange(""); window.clearTimeout(timerRef.current); onSearchRef.current(""); }}>×</button>}
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
  okDisabled?: boolean;
  okVariant?: ButtonVariant;
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
  okText,
  okDisabled = false,
  okVariant = "primary",
  cancelText,
  confirmLoading = false,
  closeOnBackdrop = true,
  width = 520,
}: ModalProps) {
  const { t } = useTranslation("common");
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
      const activeElement = document.activeElement;
      const targetIndex = getFocusTrapTargetIndex(
        elements.length,
        elements.indexOf(activeElement as HTMLElement),
        event.shiftKey,
        Boolean(dialog?.contains(activeElement)),
      );
      if (targetIndex !== null) {
        event.preventDefault();
        elements[targetIndex].focus();
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
    if (!onOk || busy || okDisabled) return;
    setSubmitError("");
    try {
      setSubmitting(true);
      await onOk();
    } catch (cause) {
      setSubmitError(translateError(cause, t, "common:components.actionFailed"));
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
          <button type="button" className="af-modal__close" aria-label={t("common:components.closeDialog")} onClick={onCancel} disabled={busy}>×</button>
        </header>
        <div className="af-modal__body">
          {children}
          {submitError && <p className="af-modal__error" role="alert">{submitError}</p>}
        </div>
        <footer className="af-modal__footer">
          <Button onClick={onCancel} disabled={busy}>{cancelText ?? t("common:components.cancel")}</Button>
          {onOk && <Button variant={okVariant} disabled={okDisabled} onClick={handleOk} loading={busy}>{okText ?? t("common:components.confirm")}</Button>}
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

export interface TabsItem {
  key: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  id?: string;
  items: TabsItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}

export function getNextEnabledTabIndex(items: TabsItem[], currentIndex: number, key: string): number {
  const enabled = items.map((item, index) => item.disabled ? -1 : index).filter((index) => index >= 0);
  if (!enabled.length) return -1;
  const currentPosition = enabled.indexOf(currentIndex);
  if (currentPosition < 0) return enabled[0];
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  if (key === "ArrowRight") return enabled[(currentPosition + 1) % enabled.length];
  if (key === "ArrowLeft") return enabled[(currentPosition - 1 + enabled.length) % enabled.length];
  return currentIndex;
}

export function Tabs({ id, items, value, onChange, ariaLabel, className = "" }: TabsProps) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveFocus = (currentIndex: number, key: string) => {
    const nextIndex = getNextEnabledTabIndex(items, currentIndex, key);
    if (nextIndex < 0 || nextIndex === currentIndex) return;
    const nextItem = items[nextIndex];
    if (!nextItem) return;
    onChange(nextItem.key);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={`af-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {items.map((item, index) => (
        <Button
          key={item.key}
          ref={(node) => { buttonRefs.current[index] = node; }}
          variant="ghost"
          type="button"
          role="tab"
          id={`${baseId}-tab-${item.key}`}
          aria-controls={`${baseId}-panel`}
          aria-selected={value === item.key}
          tabIndex={value === item.key ? 0 : -1}
          disabled={item.disabled}
          onClick={() => onChange(item.key)}
          onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
            if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              moveFocus(index, event.key);
            }
          }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
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
  emptyText?: ReactNode;
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
  emptyText,
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
  const { t } = useTranslation("common");
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
            {onSelectionChange && <th className="af-table__selection"><input type="checkbox" aria-label={t("common:components.selectAllRows")} checked={data.length > 0 && data.every((row) => selected.includes(getRowKey(row)))} onChange={(event) => toggleAll(event.target.checked)} /></th>}
            {visibleColumns.map((column) => <th scope="col" key={String(column.key)} style={{ width: column.width }}>
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
            sortedData.length === 0 ? <tr><td colSpan={emptyColumnCount} className="af-table__state">{emptyText ?? t("common:components.noData")}</td></tr> :
              sortedData.map((row, index) => <tr key={getRowKey(row)} className={rowClassName?.(row)} tabIndex={onRowClick ? 0 : undefined} aria-label={onRowClick ? "Open row" : undefined} onClick={(event) => { if (!onRowClick) return; const target = event.target; if (target instanceof Element && target.closest("button, a, input, select, textarea, [role='button']")) return; onRowClick(row); }} onKeyDown={(event) => { if (!onRowClick || event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRowClick(row); } }}>{onSelectionChange && <td className="af-table__selection"><input type="checkbox" aria-label={`Select row ${String(getRowKey(row))}`} checked={selected.includes(getRowKey(row))} onChange={(event) => toggleRow(getRowKey(row), event.target.checked)} /></td>}{visibleColumns.map((column) => {
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
  hideTitle?: boolean;
  children: ReactNode;
  onClose: () => void;
  width?: number | string;
  placement?: "left" | "right";
  className?: string;
  leadingIcon?: ReactNode;
}
export function Drawer({ open, title, hideTitle = false, children, onClose, width = 480, placement = "right", className, leadingIcon }: DrawerProps) {
  const { t } = useTranslation("common");
  const drawerRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Animation state management: initialize based on open prop
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  // Handle mounting and visibility for animation
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Small delay to ensure DOM is updated before triggering animation
      const timer = setTimeout(() => {
        setVisible(true);
      }, 10);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
      // Unmount after animation completes (300ms duration + 50ms buffer)
      const timer = setTimeout(() => {
        setMounted(false);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Focus trap and keyboard handling - runs after drawer is mounted
  useEffect(() => {
    if (!open || !mounted) return;
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
        return;
      }
      const activeElement = document.activeElement;
      const targetIndex = getFocusTrapTargetIndex(
        items.length,
        items.indexOf(activeElement as HTMLElement),
        event.shiftKey,
        Boolean(drawer?.contains(activeElement)),
      );
      if (targetIndex !== null) {
        event.preventDefault();
        items[targetIndex].focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open, mounted]);

  if (!mounted) return null;

  // A drawer that is closing must stop behaving like an open one: it stays mounted while it animates out, and
  // until it is gone it would swallow clicks on the page behind it and keep its links focusable.
  const closing = !open;
  const backdropClasses = `af-drawer-backdrop${visible ? ' af-drawer-backdrop--visible' : ''}${closing ? ' af-drawer-backdrop--closing' : ''}`;
  const drawerClasses = `af-drawer af-drawer--${placement}${visible ? ' af-drawer--visible' : ''}`;

  return (
    <div className={[backdropClasses, className].filter(Boolean).join(" ")} inert={closing || undefined} onClick={(event) => { if (event.target === event.currentTarget) onCloseRef.current(); }}>
      <aside ref={drawerRef} tabIndex={-1} className={drawerClasses} role="dialog" aria-modal="true"
        aria-label={hideTitle ? title : undefined} aria-labelledby={hideTitle ? undefined : titleId} style={{ width }}>
        <header className="af-drawer__header">
          {hideTitle ? leadingIcon : <h2 id={titleId}>{leadingIcon}{title}</h2>}
          <button type="button" aria-label={t("common:components.closeDrawer")} onClick={() => onCloseRef.current()}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="af-drawer__body">{children}</div>
      </aside>
    </div>
  );
}

export function ConfirmDialog({
  open, title, description, confirmText, danger = false, onCancel, onConfirm,
}: {
  open: boolean; title?: string; description: ReactNode; confirmText?: string; danger?: boolean;
  onCancel: () => void; onConfirm: () => void | Promise<void>;
}) {
  const { t } = useTranslation("common");
  return (
    <Modal
      open={open}
      title={title ?? t("common:components.confirmTitle")}
      onCancel={onCancel}
      onOk={onConfirm}
      okText={confirmText ?? t("common:components.confirm")}
      okVariant={danger ? "danger" : "primary"}
    >
      <p className="af-confirm-description">{description}</p>
      {danger && <p className="af-confirm-warning">{t("common:components.cannotUndo")}</p>}
    </Modal>
  );
}

export function Popover({ trigger, children, placement = "bottom", ariaLabel, triggerClassName }: {
  trigger: ReactNode; children: ReactNode | ((dismiss: () => void) => ReactNode);
  placement?: "bottom" | "top"; ariaLabel?: string; triggerClassName?: string;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const dismiss = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    const content = contentRef.current;
    const firstFocusable = content?.querySelector<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? content)?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, dismiss]);

  return (
    <div ref={rootRef} className="af-popover">
      <button ref={triggerRef} type="button" className={["af-popover__trigger", triggerClassName].filter(Boolean).join(" ")} aria-haspopup="dialog" aria-controls={contentId} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{trigger}</button>
      {open && <div ref={contentRef} id={contentId} tabIndex={-1} className={`af-popover__content af-popover__content--${placement}`} role="dialog" aria-label={ariaLabel ?? t("common:components.additionalOptions")}>
        {typeof children === "function" ? children(dismiss) : children}
      </div>}
    </div>
  );
}

export interface AsyncSelectOption { label: string; value: string; }
export function AsyncSelect({ value, onChange, loadOptions, placeholder, debounceMs = 250, disabled = false }: {
  value?: string; onChange: (value: string, option?: AsyncSelectOption) => void;
  loadOptions: (keyword: string, signal: AbortSignal) => Promise<AsyncSelectOption[]>;
  placeholder?: string; debounceMs?: number; disabled?: boolean;
}) {
  const { t } = useTranslation("common");
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
        if (!controller.signal.aborted) setError(translateError(cause, t, "common:components.optionsFailed"));
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
        {selected?.label ?? value ?? (placeholder ?? t("common:components.searchOptionsPlaceholder"))}<span>⌄</span>
      </button>
      {open && <div className="af-async-select__menu">
        <input autoFocus value={keyword} placeholder={placeholder ?? t("common:components.searchOptionsPlaceholder")} onChange={(event) => setKeyword(event.target.value)} />
        {loading ? <div className="af-async-select__state">{t("common:components.loading")}</div> : error ? <div className="af-async-select__state af-field__error">{error}</div> : options.length ? options.map((option) => <button type="button" key={option.value} onClick={() => { onChange(option.value, option); setOpen(false); setKeyword(""); }}>{option.label}</button>) : <div className="af-async-select__state">{t("common:components.noOptions")}</div>}
      </div>}
    </div>
  );
}
