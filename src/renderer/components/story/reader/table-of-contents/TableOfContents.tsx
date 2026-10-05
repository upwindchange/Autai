import { type FC, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { useScrollActiveIntoView } from "@/hooks/useScrollActiveIntoView";
import type { ChapterView } from "@/stores/chaptersStore";

interface TableOfContentsProps {
  chapters: ChapterView[];
  currentChapterNumber: number | null;
  onSelect: (chapterNumber: number) => void;
}

/**
 * Table of contents — the chapter list for the active thread. Clicking an entry
 * jumps the reader (set position + switch chapter). Rendered inside the
 * responsive reader-controls shell. On open the current chapter is scrolled to
 * the centre of the viewport (`useScrollActiveIntoView`).
 */
export const TableOfContents: FC<TableOfContentsProps> = ({
  chapters,
  currentChapterNumber,
  onSelect,
}) => {
  const { t } = useTranslation("reader");
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useScrollActiveIntoView(activeRef, [currentChapterNumber, chapters.length]);

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
        const dimmed =
          c.rewriteStatus !== "rewritten" &&
          c.rewriteStatus !== "to_be_continued"; // not yet readable
        return (
          <li key={c.chapterNumber}>
            <button
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(c.chapterNumber)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                active ? "bg-muted font-medium text-foreground"
                : dimmed ? "text-muted-foreground/70"
                : "text-muted-foreground"
              }`}
            >
              <span className="shrink-0 text-muted-foreground/70 text-xs tabular-nums">
                {c.chapterNumber}
              </span>
              {c.title && <span className="truncate">{c.title}</span>}
              {/* `status.phase` (backend-derived per chapter) drives the
                  DotMatrix indicator; the message shows as a title tooltip.
                  `success` renders no icon — readable chapters are the resting
                  state and the check glyph would be noise on every row. */}
              {c.status.phase !== "success" && (
                <DotMatrix
                  state={c.status.phase}
                  className="ml-auto size-5 shrink-0"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};
