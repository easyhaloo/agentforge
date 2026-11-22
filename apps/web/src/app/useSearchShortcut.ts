import { useEffect } from "react";

export function useSearchShortcut(enabled: boolean, onOpen: () => void, slashEnabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const command = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const quickSearch = slashEnabled && event.key === "/" && !event.altKey && !event.metaKey && !event.ctrlKey &&
        event.target instanceof HTMLElement && !event.target.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="dialog"], [aria-expanded="true"]');
      if (command || quickSearch) {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onOpen, slashEnabled]);
}
