import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2 } from "lucide-react";
import type { ChapterView } from "@/stores/chaptersStore";

interface TableOfContentsProps {
  chapters: ChapterView[];
  currentChapterId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Table of contents — the chapter list for the active thread, read from disk via
 * the chapters store. Clicking an entry pins the reader to that chapter. A
 * chapter still being generated (status: 'streaming') shows a spinner.
 *
 * Rendered inside the responsive reader-controls shell, which supplies the
 * panel title — so this is just the body.
 */
export const TableOfContents: FC<TableOfContentsProps> = ({
  chapters,
  currentChapterId,
  onSelect,
}) => {
  const { t } = useTranslation("reader");

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
        const active = c.id === currentChapterId;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                active ?
                  "bg-muted font-medium text-foreground"
                : "text-muted-foreground"
              }`}
            >
              <span className="shrink-0 text-muted-foreground/70 text-xs tabular-nums">
                {c.chapterNumber}
              </span>
              {c.title && <span className="truncate">{c.title}</span>}
              {c.status === "streaming" && (
                <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};
