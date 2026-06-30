import { useEffect } from "react";
import { useUiStore } from "@/stores/uiStore";
import { isTypingTarget } from "./useReaderHotkeys";

/**
 * Window-level hotkeys for the entertainment reader's zen mode:
 *
 *   F10  enter zen mode (entertainment only; ignored while typing)
 *   Esc  exit zen mode (ignored while typing or while an overlay is open, so
 *        Esc keeps closing popovers / drawers / dialogs first)
 *
 * F11 stays bound to Electron's OS-fullscreen menu accelerator
 * (src/main/menu.ts) and is intentionally not handled here. The renderer-level
 * preventDefault matches the codebase's existing hotkey pattern
 * (useReaderHotkeys, EntertainmentWizard); on Linux/macOS it fully owns F10.
 *
 * Mounted once in AppContent. State is read through useUiStore.getState() inside
 * the handler so the listener never goes stale and never resubscribes.
 */
export function useZenModeHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Leave modifier-chorded keys to the browser/OS.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const { appMode, zenMode, setZenMode } = useUiStore.getState();

      if (e.key === "F10") {
        if (
          appMode === "entertainment" &&
          !zenMode &&
          !isTypingTarget(e.target)
        ) {
          e.preventDefault();
          setZenMode(true);
        }
        return;
      }

      if (e.key === "Escape") {
        if (!zenMode || isTypingTarget(e.target)) return;
        // If a Popover / Drawer / Dialog is open, let Esc dismiss it first;
        // the next Esc exits zen once nothing is open. Tooltips are excluded
        // (they're transient hover affordances, not ESC-dismissable overlays).
        const overlay = document.querySelector(
          '[role="dialog"], [data-state="open"]:not([data-slot="tooltip"]):not([data-slot="tooltip-content"])',
        );
        if (overlay) return;
        e.preventDefault();
        setZenMode(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
