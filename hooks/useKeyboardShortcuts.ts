import { useEffect } from "react";

export interface ShortcutHandlers {
  /** Cmd/Ctrl+Enter — primary action (generate, save, submit). */
  onPrimary?: () => void;
  /** Escape — secondary action (cancel, close, back). */
  onCancel?: () => void;
  /** "/" — focus the first interactive input on the page. */
  onFocusSearch?: () => void;
  /** Cmd/Ctrl+K — global jump / palette (open settings). */
  onPalette?: () => void;
}

/**
 * Power-user keyboard shortcuts. Mounts a single global keydown listener so
 * the salesperson on the iPad keyboard, the GSM at a desk, and the manager
 * reviewing posts all get the same speed wins.
 *
 * Skips events while typing in inputs/textareas/contenteditable so the user
 * can still hit "/" inside a caption without it stealing focus.
 */
export const useKeyboardShortcuts = (handlers: ShortcutHandlers): void => {
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!target || !(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const typing = isTypingTarget(e.target);

      // Cmd/Ctrl+Enter — primary
      if (meta && e.key === "Enter" && handlers.onPrimary) {
        e.preventDefault();
        handlers.onPrimary();
        return;
      }

      // Escape — cancel
      if (e.key === "Escape" && handlers.onCancel) {
        // Allow textarea/select to handle their own escape first
        if (typing && (e.target as HTMLElement).tagName === "SELECT") return;
        handlers.onCancel();
        return;
      }

      // Cmd/Ctrl+K — palette
      if (meta && e.key.toLowerCase() === "k" && handlers.onPalette) {
        e.preventDefault();
        handlers.onPalette();
        return;
      }

      // "/" — focus search/first input. Skipped while typing.
      if (!meta && e.key === "/" && handlers.onFocusSearch && !typing) {
        e.preventDefault();
        handlers.onFocusSearch();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
};
