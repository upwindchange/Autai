import { useEffect, type RefObject } from "react";

/**
 * Walk up from `el` to its nearest scrollable ancestor (the panel's list
 * viewport). Returns null when nothing overflows — a short list needs no scroll.
 */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Scroll the `activeRef` row to the centre of its scrollable list container on
 * mount / dep change. Shared by the reader's TOC and Bookmarks panels: the
 * active row is located via a transform-independent offsetTop walk (transforms
 * don't affect offsetTop, so this works inside translated panels). No-op when
 * the list doesn't overflow or the container isn't an offsetParent ancestor.
 */
export function useScrollActiveIntoView(
  activeRef: RefObject<HTMLElement | null>,
  deps: unknown[],
): void {
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    const container = findScrollParent(el);
    if (!container) return;
    // Accumulate offsetTop up to the scroll container (transform-independent).
    let top = 0;
    let node: HTMLElement | null = el;
    while (node && node !== container) {
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    if (node !== container) return; // container isn't an offsetParent ancestor
    const target = top - (container.clientHeight - el.offsetHeight) / 2;
    container.scrollTop = Math.max(0, Math.round(target));
  }, deps);
}
