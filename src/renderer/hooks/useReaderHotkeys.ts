import { useEffect, useRef, type RefObject } from "react";

interface UseReaderHotkeysOptions {
  /** The reading scroll container that Space / PageUp / PageDown / Home / End move. */
  viewportRef: RefObject<HTMLDivElement | null>;
  onPrev: () => void;
  onNext: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  /** Only active while a chapter is open (the reader surface is showing). */
  enabled: boolean;
}

/** Fraction of the viewport height scrolled per Space / PageDown / PageUp press. */
const PAGE_SCROLL_RATIO = 0.9;

/** Typing / value fields that own the keystroke themselves. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

/** Controls that own arrow / paging / Home / End / Space keys themselves — leave
 * the keystroke to them. The settings panel's Radix sliders are
 * <span role="slider"> thumbs: their keydown handler runs before this window
 * listener during bubble but only preventDefault (no stopPropagation), so without
 * this guard the reader would double-act — the slider would step AND the reader
 * would advance the chapter / scroll the viewport. */
function ownsKeystroke(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const role = el.getAttribute("role");
  return (
    el.tagName === "BUTTON" ||
    el.tagName === "SUMMARY" ||
    role === "slider" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "spinbutton" ||
    role === "tab"
  );
}

/**
 * Window-level keyboard shortcuts for the entertainment reader.
 *
 * Attached once on mount; the latest props are read through a ref so changing
 * `canGoPrev` / `canGoNext` / the nav callbacks never re-subscribes and never
 * goes stale. Only fires while `enabled` (a chapter is open) and the focus is on
 * the reading surface rather than a typing field or an owning control.
 *
 *   ←  / →        previous / next chapter (Shift+←/→ left to text selection)
 *   Space / PgDn  page down (90% of the viewport)
 *   PgUp          page up (90% of the viewport)
 *   Home / End    jump to the top / bottom of the chapter
 *
 * Ctrl/Meta/Alt-chorded keys are left to the browser/OS (Ctrl+F, Cmd+Arrow,
 * etc.), and any handled key is passed through when a control that owns it
 * (slider, button, checkbox, …) is focused, so it goes to that control instead.
 */
export function useReaderHotkeys({
  viewportRef,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
  enabled,
}: UseReaderHotkeysOptions): void {
  const latest = useRef({ onPrev, onNext, canGoPrev, canGoNext, enabled });
  latest.current = { onPrev, onNext, canGoPrev, canGoNext, enabled };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const state = latest.current;
      if (!state.enabled) return;
      if (isTypingTarget(e.target)) return;
      // Leave modifier-chorded keys to the browser/OS.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // A focused control that owns the keystroke (slider, button, …) keeps it.
      if (ownsKeystroke(e.target)) return;

      const vp = viewportRef.current;
      const step = vp ? vp.clientHeight * PAGE_SCROLL_RATIO : 0;

      switch (e.key) {
        case "ArrowLeft":
          // Shift+Arrow is text selection — don't hijack it.
          if (e.shiftKey) return;
          if (state.canGoPrev) {
            e.preventDefault();
            state.onPrev();
          }
          break;
        case "ArrowRight":
          if (e.shiftKey) return;
          if (state.canGoNext) {
            e.preventDefault();
            state.onNext();
          }
          break;
        case " ":
        case "PageDown":
          e.preventDefault();
          if (vp) vp.scrollBy({ top: step });
          break;
        case "PageUp":
          e.preventDefault();
          if (vp) vp.scrollBy({ top: -step });
          break;
        case "Home":
          e.preventDefault();
          if (vp) vp.scrollTo({ top: 0 });
          break;
        case "End":
          e.preventDefault();
          if (vp) vp.scrollTo({ top: vp ? vp.scrollHeight : 0 });
          break;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewportRef]);
}
