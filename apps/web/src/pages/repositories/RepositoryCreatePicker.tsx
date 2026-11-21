import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Input } from "../../shared/ui/components";
import "./RepositoryCreatePicker.css";

export type RepositoryCreatePickerOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

export type RepositoryCreatePickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly RepositoryCreatePickerOption[];
  heading?: string;
  searchLabel?: string;
  emptyLabel?: string;
  align?: "start" | "end";
  disabled?: boolean;
  id?: string;
};

export function RepositoryCreatePicker({
  label,
  value,
  onChange,
  options,
  heading,
  searchLabel,
  emptyLabel,
  align = "start",
  disabled = false,
  id,
}: RepositoryCreatePickerProps) {
  const { t } = useTranslation("common");
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listboxId = `${triggerId}-listbox`;
  const triggerLabelId = `${triggerId}-label`;

  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeValue, setActiveValue] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const hasSearch = Boolean(searchLabel);

  // Filter options based on trimmed search
  const filteredOptions = hasSearch && searchTerm.trim()
    ? options.filter((opt) => {
        const term = searchTerm.trim().toLowerCase();
        return opt.label.toLowerCase().includes(term) ||
          opt.description?.toLowerCase().includes(term);
      })
    : options;

  // Derive active option from enabled options
  const enabledOptions = filteredOptions.filter((opt) => !opt.disabled);
  const activeOption = enabledOptions.find((opt) => opt.value === activeValue)
    ?? enabledOptions.find((opt) => opt.value === value)
    ?? enabledOptions[0];
  const activeIndex = activeOption ? filteredOptions.indexOf(activeOption) : -1;
  const activeOptionId = activeOption ? `${triggerId}-option-${activeOption.value}` : undefined;

  // Position popup using measured bounds with correct gutter logic
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) return;

    const positionPopover = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;

      const triggerRect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const gutter = 8;
      const width = Math.min(320, viewportWidth - gutter * 2);
      const fitsFromStart = triggerRect.left + width <= viewportWidth - gutter;
      const preferredLeft = align === "end" || !fitsFromStart ? triggerRect.right - width : triggerRect.left;
      const left = Math.max(gutter, Math.min(preferredLeft, viewportWidth - gutter - width));

      popover.style.setProperty("--popover-width", `${width}px`);
      popover.style.setProperty("--popover-left", `${left - triggerRect.left}px`);

      // Measure available space
      const spaceBelow = viewportHeight - triggerRect.bottom - 6;
      const spaceAbove = triggerRect.top - 6;
      const minHeight = 100;
      const maxHeight = 420;

      // Flip if needed
      if (spaceBelow < minHeight && spaceAbove > spaceBelow) {
        popover.style.setProperty("--popover-top", "auto");
        popover.style.setProperty("--popover-bottom", `calc(100% + 6px)`);
        popover.style.setProperty("--popover-max-height", `${Math.min(maxHeight, spaceAbove)}px`);
      } else {
        popover.style.setProperty("--popover-top", `calc(100% + 6px)`);
        popover.style.setProperty("--popover-bottom", "auto");
        popover.style.setProperty("--popover-max-height", `${Math.min(maxHeight, spaceBelow)}px`);
      }
    };

    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [open, align]);

  // Focus management when opening with preventScroll
  useLayoutEffect(() => {
    if (!open) return;

    if (hasSearch) {
      searchInputRef.current?.focus({ preventScroll: true });
    } else {
      listboxRef.current?.focus({ preventScroll: true });
    }
  }, [open, hasSearch]);

  // Reset state when opening or search changes
  useEffect(() => {
    if (open) {
      setActiveValue(null);
    } else {
      setSearchTerm("");
      setActiveValue(null);
    }
  }, [open]);

  useEffect(() => {
    if (open && searchTerm !== "") {
      setActiveValue(null);
    }
  }, [searchTerm, open]);

  // Guard: close if trigger becomes disabled while open
  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  // Scroll active option into view
  useEffect(() => {
    if (!activeOptionId || !open) return;
    const activeElement = document.getElementById(activeOptionId);
    activeElement?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId, open]);

  // Dismiss on pointerdown outside
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const handleSelect = (option: RepositoryCreatePickerOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActiveIndex = (direction: "up" | "down" | "home" | "end") => {
    if (enabledOptions.length === 0) return;

    let nextIndex = activeIndex;

    if (direction === "home") {
      nextIndex = 0;
    } else if (direction === "end") {
      nextIndex = filteredOptions.length - 1;
    } else if (direction === "down") {
      nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % filteredOptions.length;
    } else if (direction === "up") {
      nextIndex = activeIndex <= 0 ? filteredOptions.length - 1 : activeIndex - 1;
    }

    // Skip disabled options with wrapping
    let attempts = 0;
    while (attempts < filteredOptions.length && filteredOptions[nextIndex]?.disabled) {
      if (direction === "down" || direction === "home") {
        nextIndex = (nextIndex + 1) % filteredOptions.length;
      } else {
        nextIndex = nextIndex <= 0 ? filteredOptions.length - 1 : nextIndex - 1;
      }
      attempts++;
    }

    const nextOption = filteredOptions[nextIndex];
    if (nextOption && !nextOption.disabled) {
      setActiveValue(nextOption.value);
    }
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(!open);
    } else if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      setOpen(true);
    }
  };

  // Shared keyboard handler for search input and listbox
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    // Skip if IME composition is active
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === "Enter" || (!hasSearch && event.key === " ")) {
      // Prevent form submission while choosing an option.
      event.preventDefault();
      if (activeOption) {
        handleSelect(activeOption);
      }
      return;
    }

    // Arrow keys navigate
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveIndex("down");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveIndex("up");
    } else if (event.key === "Home") {
      // Only preventDefault for listbox, not search input (preserve text editing)
      if (!hasSearch || event.currentTarget !== searchInputRef.current) {
        event.preventDefault();
        moveActiveIndex("home");
      }
    } else if (event.key === "End") {
      // Only preventDefault for listbox, not search input (preserve text editing)
      if (!hasSearch || event.currentTarget !== searchInputRef.current) {
        event.preventDefault();
        moveActiveIndex("end");
      }
    }
  };

  const handleRootBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!open) return;
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget === triggerRef.current || !event.currentTarget.contains(relatedTarget)) {
      setOpen(false);
    }
  };

  const handleOptionMouseDown = (event: React.MouseEvent) => {
    // Prevent blur on option click to keep focus on input/listbox until click completes
    event.preventDefault();
  };

  return (
    <div className="repo-create-picker" ref={rootRef} onBlur={handleRootBlur}>
      <span id={triggerLabelId} className="repo-create-picker__sr-only">
        {label}
      </span>
      <Button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="repo-create-picker__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-describedby={triggerLabelId}
        onMouseDown={(event) => { if (open) event.preventDefault(); }}
        onClick={() => {
          if (open) triggerRef.current?.focus();
          setOpen(!open);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="repo-create-picker__trigger-content">
          {selectedOption?.icon && (
            <span className="repo-create-picker__trigger-icon" aria-hidden="true">
              {selectedOption.icon}
            </span>
          )}
          <span className="repo-create-picker__trigger-label">
            {selectedOption?.label || label}
          </span>
        </span>
        <ChevronDown
          size={14}
          className="repo-create-picker__trigger-chevron"
          aria-hidden="true"
        />
      </Button>

      {open && (
        <div
          ref={popoverRef}
          className="repo-create-picker__popover"
        >
          {heading && (
            <div className="repo-create-picker__heading">{heading}</div>
          )}

          {hasSearch && (
            <div className="repo-create-picker__search">
              <Search size={14} className="repo-create-picker__search-icon" aria-hidden="true" />
              <Input
                ref={searchInputRef}
                type="text"
                className="repo-create-picker__search-input"
                placeholder={searchLabel}
                aria-label={searchLabel}
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                role="combobox"
                aria-autocomplete="list"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyDown}
                controlSize="middle"
              />
            </div>
          )}

          <div
            ref={listboxRef}
            id={listboxId}
            className="repo-create-picker__options"
            role="listbox"
            aria-labelledby={triggerId}
            aria-activedescendant={activeOptionId}
            tabIndex={hasSearch ? -1 : 0}
            onKeyDown={hasSearch ? undefined : handleKeyDown}
          >
            {filteredOptions.length === 0 ? (
              <div className="repo-create-picker__empty" role="status">
                {emptyLabel || t("components.noOptions")}
              </div>
            ) : (
              filteredOptions.map((option, index) => {
                const isSelected = option.value === value;
                const isActive = index === activeIndex;
                return (
                  <div
                    key={option.value}
                    id={`${triggerId}-option-${option.value}`}
                    role="option"
                    className={`repo-create-picker__option${
                      isSelected ? " repo-create-picker__option--selected" : ""
                    }${option.disabled ? " repo-create-picker__option--disabled" : ""
                    }${isActive ? " repo-create-picker__option--active" : ""}`}
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onMouseDown={handleOptionMouseDown}
                    onClick={() => handleSelect(option)}
                  >
                    <Check size={14} className="repo-create-picker__option-check" aria-hidden="true" />
                    {option.icon && (
                      <span
                        className="repo-create-picker__option-icon"
                        aria-hidden="true"
                      >
                        {option.icon}
                      </span>
                    )}
                    <span className="repo-create-picker__option-content">
                      <span className="repo-create-picker__option-label">
                        {option.label}
                      </span>
                      {option.description && (
                        <span className="repo-create-picker__option-description">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
