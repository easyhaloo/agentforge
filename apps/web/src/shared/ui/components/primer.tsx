import { useEffect, useRef, type FormEvent, type HTMLAttributes, type ReactNode } from "react";

/* ==========================================================================
   CounterLabel
   ========================================================================== */

export interface CounterLabelProps extends HTMLAttributes<HTMLSpanElement> {
  scheme?: "primary" | "secondary";
  children: ReactNode;
}

export function CounterLabel({
  scheme = "primary",
  className = "",
  children,
  ...rest
}: CounterLabelProps) {
  return (
    <span
      {...rest}
      className={`af-counter ${scheme === "secondary" ? "af-counter--secondary" : ""} ${className}`.trim()}
    >
      {children}
    </span>
  );
}

/* ==========================================================================
   Label (Semantic Pill)
   ========================================================================== */

export type LabelVariant = "default" | "accent" | "success" | "done" | "attention" | "danger";

export interface LabelProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: LabelVariant;
  children: ReactNode;
}

export function Label({
  variant = "default",
  className = "",
  children,
  ...rest
}: LabelProps) {
  const variantClass = variant === "default" ? "" : `af-label--${variant}`;
  return (
    <span {...rest} className={`af-label ${variantClass} ${className}`.trim()}>
      {children}
    </span>
  );
}

/* ==========================================================================
   StateLabel (Solid Emphasis Status Pill)
   ========================================================================== */

export type StateLabelStatus = "open" | "merged" | "closed" | "draft";

export interface StateLabelProps extends HTMLAttributes<HTMLSpanElement> {
  status: StateLabelStatus;
  size?: "small" | "medium";
  icon?: ReactNode;
  children: ReactNode;
}

export function StateLabel({
  status,
  size = "medium",
  icon,
  className = "",
  children,
  ...rest
}: StateLabelProps) {
  return (
    <span
      {...rest}
      className={`af-state-label af-state-label--${status} ${size === "small" ? "af-state-label--small" : ""} ${className}`.trim()}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}

/* ==========================================================================
   BranchChip
   ========================================================================== */

export interface BranchChipProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function BranchChip({ className = "", children, ...rest }: BranchChipProps) {
  return (
    <span {...rest} className={`af-branch-chip ${className}`.trim()}>
      {children}
    </span>
  );
}

/* ==========================================================================
   BorderBox (Box / Header / Row)
   ========================================================================== */

export interface BorderBoxProps extends HTMLAttributes<HTMLDivElement> {
  danger?: boolean;
  children: ReactNode;
}

export function BorderBox({ danger = false, className = "", children, ...rest }: BorderBoxProps) {
  return (
    <div {...rest} className={`af-box ${danger ? "af-box--danger" : ""} ${className}`.trim()}>
      {children}
    </div>
  );
}

export interface BorderBoxHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function BorderBoxHeader({ className = "", children, ...rest }: BorderBoxHeaderProps) {
  return (
    <div {...rest} className={`af-box__header ${className}`.trim()}>
      {children}
    </div>
  );
}

export interface BorderBoxRowProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  children: ReactNode;
}

export function BorderBoxRow({
  hoverable = false,
  className = "",
  children,
  ...rest
}: BorderBoxRowProps) {
  return (
    <div
      {...rest}
      className={`af-box__row ${hoverable ? "af-box__row--hover" : ""} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

/* ==========================================================================
   Subhead
   ========================================================================== */

export interface SubheadProps {
  heading: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  danger?: boolean;
  as?: "h1" | "h2" | "h3";
  className?: string;
}

export function Subhead({
  heading,
  description,
  actions,
  danger = false,
  as: HeadingTag = "h2",
  className = "",
}: SubheadProps) {
  return (
    <div className={`af-subhead ${danger ? "af-subhead--danger" : ""} ${className}`.trim()}>
      <div className="af-subhead__copy">
        <HeadingTag className="af-subhead__heading">{heading}</HeadingTag>
        {description && <p className="af-subhead__description">{description}</p>}
      </div>
      {actions && <div className="af-subhead__actions">{actions}</div>}
    </div>
  );
}

/* ==========================================================================
   UnderlineNav
   ========================================================================== */

export interface UnderlineNavItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  counter?: number | string;
  disabled?: boolean;
}

export interface UnderlineNavProps {
  items: readonly UnderlineNavItem[];
  activeKey: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  className?: string;
}

export function UnderlineNav({
  items,
  activeKey,
  onChange,
  ariaLabel,
  className = "",
}: UnderlineNavProps) {
  return (
    <nav className={`af-underline-nav ${className}`.trim()} aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            aria-current={active ? "page" : undefined}
            className={`af-underline-nav__item ${active ? "is-active" : ""}`.trim()}
            onClick={() => onChange(item.key)}
          >
            <span className="af-underline-nav__pill">
              {item.icon && (
                <span className="af-underline-nav__icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span>{item.label}</span>
              {item.counter !== undefined && <CounterLabel>{item.counter}</CounterLabel>}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ==========================================================================
   ActionList (List / Group / Item)
   ========================================================================== */

export interface ActionListProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ActionList({ className = "", children, ...rest }: ActionListProps) {
  return (
    <div {...rest} className={`af-action-list ${className}`.trim()}>
      {children}
    </div>
  );
}

export interface ActionListGroupProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function ActionListGroup({ title, children, className = "" }: ActionListGroupProps) {
  return (
    <div className={`af-action-list__group ${className}`.trim()}>
      {title && <div className="af-action-list__group-title">{title}</div>}
      <div className="af-action-list">{children}</div>
    </div>
  );
}

export interface ActionListItemProps {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  trailingVisual?: ReactNode;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

export function ActionListItem({
  active = false,
  danger = false,
  disabled = false,
  leadingIcon,
  trailingVisual,
  onClick,
  className = "",
  children,
}: ActionListItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`af-action-list__item ${active ? "is-active" : ""} ${danger ? "af-action-list__item--danger" : ""} ${className}`.trim()}
    >
      <span className="af-action-list__lead">
        {leadingIcon && (
          <span className="af-action-list__icon" aria-hidden="true">
            {leadingIcon}
          </span>
        )}
        <span>{children}</span>
      </span>
      {trailingVisual}
    </button>
  );
}

/* ==========================================================================
   DiffStat (+N / -M & 5 proportional blocks)
   ========================================================================== */

export type DiffStatBlock = "add" | "del" | "neutral";

export function computeDiffStatBlocks(additions: number, deletions: number): DiffStatBlock[] {
  const adds = Math.max(0, Math.floor(additions));
  const dels = Math.max(0, Math.floor(deletions));
  const total = adds + dels;
  if (total === 0) {
    return ["neutral", "neutral", "neutral", "neutral", "neutral"];
  }
  if (total < 5) {
    return [
      ...Array<DiffStatBlock>(adds).fill("add"),
      ...Array<DiffStatBlock>(dels).fill("del"),
      ...Array<DiffStatBlock>(5 - total).fill("neutral"),
    ];
  }
  let addBlocks = Math.round((adds / total) * 5);
  if (adds > 0 && addBlocks === 0) addBlocks = 1;
  if (dels > 0 && addBlocks === 5) addBlocks = 4;
  const delBlocks = 5 - addBlocks;
  return [
    ...Array<DiffStatBlock>(addBlocks).fill("add"),
    ...Array<DiffStatBlock>(delBlocks).fill("del"),
  ];
}

export interface DiffStatProps extends HTMLAttributes<HTMLSpanElement> {
  additions: number;
  deletions: number;
  showBlocks?: boolean;
}

export function DiffStat({
  additions,
  deletions,
  showBlocks = true,
  className = "",
  ...rest
}: DiffStatProps) {
  const adds = Math.max(0, Math.floor(additions));
  const dels = Math.max(0, Math.floor(deletions));
  const blocks = showBlocks ? computeDiffStatBlocks(adds, dels) : [];
  return (
    <span
      {...rest}
      aria-label={rest["aria-label"] ?? `+${adds} -${dels}`}
      className={`af-diff-stat ${className}`.trim()}
    >
      <span className="af-diff-stat__add">+{adds}</span>
      <span className="af-diff-stat__del">-{dels}</span>
      {showBlocks && (
        <span className="af-diff-stat__blocks" aria-hidden="true">
          {blocks.map((kind, index) => (
            <span key={index} className={`af-diff-stat__block af-diff-stat__block--${kind}`} />
          ))}
        </span>
      )}
    </span>
  );
}

/* ==========================================================================
   FileStatusBadge (A / M / D / R)
   ========================================================================== */

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

const fileStatusLetter: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

export interface FileStatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: FileStatus;
}

export function FileStatusBadge({
  status,
  className = "",
  title,
  ...rest
}: FileStatusBadgeProps) {
  return (
    <span
      {...rest}
      title={title ?? status}
      aria-label={rest["aria-label"] ?? status}
      className={`af-file-status af-file-status--${status} ${className}`.trim()}
    >
      {fileStatusLetter[status]}
    </span>
  );
}

/* ==========================================================================
   ButtonGroup
   ========================================================================== */

export interface ButtonGroupProps extends HTMLAttributes<HTMLDivElement> {
  ariaLabel?: string;
  children: ReactNode;
}

export function ButtonGroup({
  ariaLabel,
  className = "",
  children,
  ...rest
}: ButtonGroupProps) {
  return (
    <div
      {...rest}
      role="group"
      aria-label={ariaLabel ?? rest["aria-label"]}
      className={`af-button-group ${className}`.trim()}
    >
      {children}
    </div>
  );
}

/* ==========================================================================
   FilterBar (Query Search + Prefix + Trailing Controls + Primary Action)
   ========================================================================== */

export interface FilterBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  clearAriaLabel?: string;
  filterPrefix?: ReactNode;
  trailingControls?: ReactNode;
  primaryAction?: ReactNode;
  debounceMs?: number;
  clearable?: boolean;
  className?: string;
}

export function FilterBar({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder,
  ariaLabel = "Filter",
  clearAriaLabel = "Clear filter",
  filterPrefix,
  trailingControls,
  primaryAction,
  debounceMs = 300,
  clearable = true,
  className = "",
}: FilterBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!onSubmit || debounceMs <= 0) return;
    const timer = window.setTimeout(() => onSubmit(value), debounceMs);
    return () => window.clearTimeout(timer);
  }, [value, debounceMs, onSubmit]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.(value);
  };

  const handleClear = () => {
    onChange("");
    onClear?.();
    onSubmit?.("");
    inputRef.current?.focus();
  };

  return (
    <form className={`af-filter-bar ${className}`.trim()} onSubmit={handleSubmit} role="search">
      <div className={`af-filter-bar__query ${filterPrefix ? "af-filter-bar__query--with-prefix" : ""}`.trim()}>
        {filterPrefix && <div className="af-filter-bar__prefix">{filterPrefix}</div>}
        <div className="af-filter-bar__input-wrap">
          <input
            ref={inputRef}
            type="text"
            className="af-filter-bar__input"
            value={value}
            placeholder={placeholder}
            aria-label={ariaLabel}
            onChange={(event) => onChange(event.target.value)}
          />
          {clearable && value.length > 0 && (
            <button
              type="button"
              className="af-filter-bar__clear"
              aria-label={clearAriaLabel}
              onClick={handleClear}
            >
              ×
            </button>
          )}
        </div>
      </div>
      {trailingControls && <div className="af-filter-bar__trailing">{trailingControls}</div>}
      {primaryAction && <div className="af-filter-bar__primary">{primaryAction}</div>}
    </form>
  );
}
