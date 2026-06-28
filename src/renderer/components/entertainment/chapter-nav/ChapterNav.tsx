import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChapterNavProps {
  /** Show the "previous chapter" button — hidden on the first chapter. */
  canGoPrev: boolean;
  /** A chapter is available to dehydrate — disables "next" when false (all done). */
  canGoNext: boolean;
  /** A chapter fetch/stream is in progress — disables "next" + shows a spinner. */
  fetching: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Bottom-center chapter navigation for the paginated reader. Previous is hidden
 * on the first chapter; next is disabled while a chapter is dehydrating
 * (`fetching`) or when no unprocessed chapter remains (`canGoNext`). Labels
 * collapse to icons only on narrow viewports so the pill stays compact on
 * mobile. The wrapper is pointer-events-none so it never blocks scroll except
 * on the pill itself.
 */
export const ChapterNav: FC<ChapterNavProps> = ({
  canGoPrev,
  canGoNext,
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
            <NavChevronLeft className="size-4" />
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
          disabled={!canGoNext || fetching}
          className="rounded-full"
        >
          <span className="hidden sm:inline">{t("reader.chapter.next")}</span>
          {fetching ?
            <Loader2 className="size-4 animate-spin" />
          : <NavChevronRight className="size-4" />}
        </Button>
      </div>
    </div>
  );
};

/**
 * Animated chevrons for chapter navigation. The strokes draw themselves in over
 * ~0.4s via SMIL (`stroke-dashoffset` 12 → 0, frozen at the end), so the arrow
 * "writes" itself whenever the icon (re)mounts — on first appearance, and again
 * when the next button swaps back from its loading spinner.
 *
 * Prev points left and leads the label; next points right and trails it.
 */
const NavChevronLeft: FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <path d="M0 0h24v24H0z" fill="none" />
    <path
      stroke="currentColor"
      strokeDasharray="12"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M8 12l7 -7M8 12l7 7"
    >
      <animate
        fill="freeze"
        attributeName="stroke-dashoffset"
        dur="0.4s"
        values="12;0"
      />
    </path>
  </svg>
);

const NavChevronRight: FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <path d="M0 0h24v24H0z" fill="none" />
    <path
      stroke="currentColor"
      strokeDasharray="12"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M16 12l-7 -7M16 12l-7 7"
    >
      <animate
        fill="freeze"
        attributeName="stroke-dashoffset"
        dur="0.4s"
        values="12;0"
      />
    </path>
  </svg>
);
