import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChapterNavProps {
  /** Show the "previous chapter" button — hidden on the first chapter. */
  canGoPrev: boolean;
  /** A chapter fetch/stream is in progress — disables "next". */
  fetching: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Bottom-center chapter navigation for the paginated reader. Previous is hidden
 * on the first chapter; next is disabled while a chapter is streaming. Labels
 * collapse to icons only on narrow viewports so the pill stays compact on
 * mobile. The wrapper is pointer-events-none so it never blocks scroll except
 * on the pill itself.
 */
export const ChapterNav: FC<ChapterNavProps> = ({
  canGoPrev,
  fetching,
  onPrev,
  onNext,
}) => {
  const { t } = useTranslation("reader");
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border bg-background/85 p-1 shadow-md backdrop-blur">
        {canGoPrev && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPrev}
            className="rounded-full"
          >
            <ChevronLeft className="size-4" />
            <span className="hidden sm:inline">
              {t("reader.chapter.previous")}
            </span>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onNext}
          disabled={fetching}
          className="rounded-full"
        >
          {fetching ?
            <Loader2 className="size-4 animate-spin" />
          : <ChevronRight className="size-4" />}
          <span className="hidden sm:inline">{t("reader.chapter.next")}</span>
        </Button>
      </div>
    </div>
  );
};
