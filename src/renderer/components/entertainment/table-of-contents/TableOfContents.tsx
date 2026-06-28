import { type FC, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2 } from "lucide-react";
import type { ChapterView } from "@/stores/chaptersStore";

interface TableOfContentsProps {
  chapters: ChapterView[];
  currentChapterNumber: number | null;
  onSelect: (chapterNumber: number) => void;
}

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
 * Table of contents — the chapter list for the active thread. Clicking an entry
 * jumps the reader (set position + kick the worker for that chapter). A chapter
 * being fetched/rewritten shows a spinner; one not yet rewritten is dimmed but
 * still selectable. Rendered inside the responsive reader-controls shell.
 *
 * On open (the panel mounts this list fresh) the current chapter is scrolled to
 * the centre of the viewport. Measurement uses offsetTop — transform-independent,
 * so it stays correct mid open-animation — and is confined to the panel's own
 * scroll container, never the page.
 */
export const TableOfContents: FC<TableOfContentsProps> = ({
  chapters,
  currentChapterNumber,
  onSelect,
}) => {
  const { t } = useTranslation("reader");
  const activeRef = useRef<HTMLButtonElement | null>(null);

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
  }, [currentChapterNumber, chapters.length]);

  if (chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
        <BookOpen className="size-6 opacity-50" />
        <p className="text-sm">{t("reader.toc.empty")}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {chapters.map((c) => {
        const active = c.chapterNumber === currentChapterNumber;
        const busy =
          c.sourceStatus === "fetching" || c.rewriteStatus === "rewriting";
        const dimmed = c.rewriteStatus !== "rewritten"; // not yet readable
        return (
          <li key={c.chapterNumber}>
            <button
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(c.chapterNumber)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                active ?
                  "bg-muted font-medium text-foreground"
                : dimmed ?
                  "text-muted-foreground/70"
                : "text-muted-foreground"
              }`}
            >
              <span className="shrink-0 text-muted-foreground/70 text-xs tabular-nums">
                {c.chapterNumber}
              </span>
              {c.title && <span className="truncate">{c.title}</span>}
              {busy && (
                <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};
