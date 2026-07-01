import { type FC, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Bookmark as BookmarkType } from "@shared";

interface BookmarksProps {
  bookmarks: BookmarkType[];
  currentChapterNumber: number | null;
  onAdd: () => void;
  onJump: (bookmark: BookmarkType) => void;
  onDelete: (id: string) => void;
}

/**
 * Walk up from `el` to its nearest scrollable ancestor (the panel's list
 * viewport). Returns null when nothing overflows — a short list needs no scroll.
 * (Same helper as the TOC: the active row is scrolled into view on open.)
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
 * Parse the bookmark's `createdAt` for display. The DB stores it as SQLite
 * `datetime('now')` = "YYYY-MM-DD HH:MM:SS" (UTC, space-separated); normalize to
 * ISO so `new Date` reads it as UTC rather than local time. ISO strings pass
 * through unchanged.
 */
function parseTimestamp(s: string): Date {
  return new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}

/**
 * Bookmarks panel — the reader's saved spots. A prominent "Bookmark this spot"
 * button at the top captures the current chapter + scroll position; the list
 * below jumps (click row) or deletes (trash). Each row is auto-labelled from
 * its chapter so it localizes; a stored `label`, if present, takes precedence.
 * Rendered inside the responsive reader-controls shell (Popover on desktop,
 * bottom-sheet Drawer on mobile) and mirrors the TOC's structure.
 */
export const Bookmarks: FC<BookmarksProps> = ({
  bookmarks,
  currentChapterNumber,
  onAdd,
  onJump,
  onDelete,
}) => {
  const { t, i18n } = useTranslation("reader");
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const formatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "short",
  });

  // Scroll the current chapter's bookmark row into view on open / chapter change
  // — same transform-independent offsetTop walk as the TOC.
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    const container = findScrollParent(el);
    if (!container) return;
    let top = 0;
    let node: HTMLElement | null = el;
    while (node && node !== container) {
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    if (node !== container) return;
    const target = top - (container.clientHeight - el.offsetHeight) / 2;
    container.scrollTop = Math.max(0, Math.round(target));
  }, [currentChapterNumber, bookmarks.length]);

  const labelFor = (b: BookmarkType) =>
    b.label ??
    t("reader.bookmarks.chapterLabel", { n: b.chapterNumber }) +
      (b.title ? ` — ${b.title}` : "");

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        onClick={onAdd}
        disabled={currentChapterNumber == null}
        className="w-full justify-start gap-2"
      >
        <BookmarkPlus className="size-4" />
        {t("reader.bookmarks.add")}
      </Button>

      {bookmarks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
          <Bookmark className="size-6 opacity-50" />
          <p className="text-sm">{t("reader.bookmarks.empty")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {bookmarks.map((b) => {
            const active = b.chapterNumber === currentChapterNumber;
            return (
              <li key={b.id} className="flex items-center gap-1">
                <button
                  ref={active ? activeRef : undefined}
                  type="button"
                  onClick={() => onJump(b)}
                  aria-label={t("reader.bookmarks.jump")}
                  className={`flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                    active ?
                      "bg-muted font-medium text-foreground"
                    : "text-muted-foreground"
                  }`}
                >
                  <span className="shrink-0 text-muted-foreground/70 text-xs tabular-nums">
                    {b.chapterNumber}
                  </span>
                  <span className="truncate">{labelFor(b)}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground/60 text-xs tabular-nums">
                    {formatter.format(parseTimestamp(b.createdAt))}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(b.id)}
                  aria-label={t("reader.bookmarks.delete")}
                  className="size-7 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
