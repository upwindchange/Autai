import { type FC, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, List, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { DotMatrix, type DotMatrixState } from "@/components/assistant-ui/dot-matrix";
import { useChaptersStore } from "@/stores/chaptersStore";
import { useBookmarksStore } from "@/stores/bookmarksStore";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { ReaderSettingsPanel } from "./reader-settings/ReaderSettingsPanel";
import { TableOfContents } from "./table-of-contents/TableOfContents";
import { Bookmarks } from "./bookmarks/Bookmarks";

// Refresh cadence for the chapter list while the footer is shown.
const POLL_MS = 1500;

interface ReaderFooterProps {
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Pinned open by a tap/click on the reading surface (mobile + desktop). */
  pinned: boolean;
  /** Hovered: pointer is in the bottom reveal band (desktop only). */
  hovered: boolean;
  /** Current within-chapter scroll ratio (0–1), captured into a bookmark anchor. */
  getScrollRatio: () => number | null;
  /** Jump to a chapter (+ optional scroll ratio to restore). The TOC jumps
   *  through here too (null ratio → top) so all chapter changes share one path. */
  onJumpBookmark: (chapterNumber: number, scrollRatio: number | null) => void;
}

/**
 * Unified bottom reader footer: [settings] [prev • next] [toc], centered and
 * symmetric. Hidden by default; slides up from the bottom when the pointer is
 * in the bottom reveal band (desktop — detected by the host via mousemove, so
 * no overlay blocks the prose) OR the reading surface is tapped (`pinned`).
 * Slides back down when the pointer leaves the band (unless pinned/a panel is
 * open) or the surface is tapped a second time — so it works on mobile touch
 * without a hover affordance. Settings/TOC open as a Popover (desktop) or
 * bottom-sheet Drawer (mobile) and keep the footer open while visible.
 *
 * The Next button mirrors the TOC's per-chapter phase indicator: while the next
 * chapter is being fetched/rewritten it shows a `loading`/`uploading` DotMatrix
 * instead of the right chevron (same status logic as the TOC row indicator).
 *
 * While visible, the chapter list is polled every POLL_MS so the TOC and the
 * next-chapter nav indicator stay fresh with backend progress; polling stops as
 * soon as the footer hides.
 */
export const ReaderFooter: FC<ReaderFooterProps> = ({
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  pinned,
  hovered,
  getScrollRatio,
  onJumpBookmark,
}) => {
  const { t } = useTranslation("reader");
  const isMobile = useIsMobile();
  const zenMode = useUiStore((s) => s.zenMode);
  const toggleZenMode = useUiStore((s) => s.toggleZenMode);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);

  // TOC data comes from the chapters store (this footer lives inside the
  // entertainment tree, so the active thread is already loaded). Chapter jumps
  // (TOC + bookmarks) go through `onJumpBookmark`, owned by the reader host.
  const chapters = useChaptersStore((s) => s.chapters);
  const currentChapterNumber = useChaptersStore((s) => s.currentChapterNumber);
  const currentThreadId = useChaptersStore((s) => s.currentThreadId);
  const loadChapters = useChaptersStore((s) => s.loadChapters);

  // Bookmarks for the active thread. Loaded once per thread switch (no poll —
  // bookmarks only change via this client); add/remove mutate the store directly.
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const loadBookmarks = useBookmarksStore((s) => s.loadBookmarks);
  const addBookmark = useBookmarksStore((s) => s.addBookmark);
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark);

  const visible = pinned || hovered || settingsOpen || tocOpen || bookmarksOpen;

  // Poll the chapter list WHILE the footer is shown, so the TOC rows and the
  // next-chapter nav indicator track backend progress. Stops the instant it
  // hides — no idle polling and no "is anything still busy?" detection. The
  // fetch preserves cached per-chapter content (store merge) and no UI
  // subscribes to the `loading` flag, so this is flicker-free. Overlapping
  // loads are skipped via the loading guard.
  useEffect(() => {
    if (!visible || !currentThreadId) return;
    const tick = () => {
      if (useChaptersStore.getState().loading) return;
      void loadChapters(currentThreadId);
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [visible, currentThreadId, loadChapters]);

  // Load bookmarks once per thread switch (no poll — they only change via this
  // client; add/remove mutate the store directly).
  useEffect(() => {
    if (!currentThreadId) return;
    void loadBookmarks(currentThreadId);
  }, [currentThreadId, loadBookmarks]);

  // Next chapter's pipeline phase — same logic as the TOC row indicator.
  const next = chapters.find(
    (c) => c.chapterNumber === (currentChapterNumber ?? 0) + 1,
  );
  let nextPhase: DotMatrixState | null = null;
  if (next?.sourceStatus === "fetching") nextPhase = "loading";
  else if (next?.rewriteStatus === "rewriting") nextPhase = "uploading";

  // Jumping via the TOC goes through the host's shared jump path (null ratio →
  // chapter top), then closes the TOC so the reader takes over (e-reader
  // convention: pick a chapter → read it).
  const handleSelect = (n: number) => {
    onJumpBookmark(n, null);
    setTocOpen(false);
  };

  // Bookmark a spot at the current scroll position; keep the panel open so the
  // new entry appears at the top of the list.
  const handleAddBookmark = () => {
    if (!currentThreadId || currentChapterNumber == null) return;
    void addBookmark(currentThreadId, {
      chapterNumber: currentChapterNumber,
      scrollRatio: getScrollRatio(),
    });
  };

  const handleJumpBookmark = (chapterNumber: number, scrollRatio: number | null) => {
    onJumpBookmark(chapterNumber, scrollRatio);
    setBookmarksOpen(false);
  };

  const handleDeleteBookmark = (id: string) => {
    if (!currentThreadId) return;
    void removeBookmark(currentThreadId, id);
  };

  const settingsTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("reader.openSettings")}
      className="size-9 rounded-full"
    >
      <span className="text-base font-semibold leading-none">Aa</span>
    </Button>
  );

  const tocTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("reader.toc.title")}
      className="size-9 rounded-full"
    >
      <List className="size-5" />
    </Button>
  );

  // Subtle hint (not a toggle): the icon tints primary when the current chapter
  // already has ≥1 bookmark. Tapping still opens the panel either way.
  const currentHasBookmark =
    currentChapterNumber != null &&
    bookmarks.some((b) => b.chapterNumber === currentChapterNumber);
  const bookmarksTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("reader.bookmarks.open")}
      className="size-9 rounded-full"
    >
      <Bookmark className={cn("size-5", currentHasBookmark && "text-primary")} />
    </Button>
  );

  return (
    // Container is pointer-events-none so only the pill (when visible) captures
    // input; the reading surface beneath stays fully interactive.
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
      <TooltipProvider delayDuration={300}>
        <div
          className={cn(
            "flex items-center gap-1 rounded-full border bg-background/85 p-1 shadow-md backdrop-blur transition-all duration-200 ease-out",
            visible ?
              "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-24 opacity-0",
          )}
        >
          {/* Settings (left) */}
          <ResponsivePanel
            isMobile={isMobile}
            title={t("reader.title")}
            tooltip={t("reader.openSettings")}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            trigger={settingsTrigger}
          >
            <ReaderSettingsPanel />
          </ResponsivePanel>

          {/* Chapter nav (center) */}
          <div className="flex items-center">
            {canGoPrev && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onPrev}
                aria-label={t("reader.chapter.previous")}
                className="size-9 rounded-full"
              >
                <NavChevronLeft className="size-4" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onNext}
              disabled={!canGoNext}
              aria-label={t("reader.chapter.next")}
              className="size-9 rounded-full"
            >
              {nextPhase ?
                <DotMatrix state={nextPhase} className="size-4" />
              : <NavChevronRight className="size-4" />}
            </Button>
          </div>

          {/* TOC (right) */}
          <ResponsivePanel
            isMobile={isMobile}
            title={t("reader.toc.title")}
            tooltip={t("reader.toc.title")}
            open={tocOpen}
            onOpenChange={setTocOpen}
            trigger={tocTrigger}
          >
            <TableOfContents
              chapters={chapters}
              currentChapterNumber={currentChapterNumber}
              onSelect={handleSelect}
            />
          </ResponsivePanel>

          {/* Bookmarks (right) */}
          <ResponsivePanel
            isMobile={isMobile}
            title={t("reader.bookmarks.title")}
            tooltip={t("reader.bookmarks.open")}
            open={bookmarksOpen}
            onOpenChange={setBookmarksOpen}
            trigger={bookmarksTrigger}
          >
            <Bookmarks
              bookmarks={bookmarks}
              currentChapterNumber={currentChapterNumber}
              onAdd={handleAddBookmark}
              onJump={(b) =>
                handleJumpBookmark(b.chapterNumber, b.anchor?.scrollRatio ?? null)
              }
              onDelete={handleDeleteBookmark}
            />
          </ResponsivePanel>

          {/* Zen toggle (right edge) — hides all chrome so the reader fills the
              window. In zen the footer stays hidden until the surface is tapped
              (pinned), so this button is also the mouse exit path. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={toggleZenMode}
                aria-label={
                  zenMode ? t("reader.zen.exit") : t("reader.zen.enter")
                }
                aria-pressed={zenMode}
                className="size-9 rounded-full"
              >
                {zenMode ?
                  <Minimize2 className="size-5" />
                : <Maximize2 className="size-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {zenMode ? t("reader.zen.exit") : t("reader.zen.enter")}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
};

interface ResponsivePanelProps {
  isMobile: boolean;
  title: string;
  tooltip: string;
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Wraps a trigger + panel content in a Popover (desktop) or bottom-sheet Drawer
 * (mobile), with a tooltip on the trigger. `open`/`onOpenChange` are owned by
 * the caller so the footer can stay visible while a panel is open; the tooltip
 * is forced closed while its own panel is open. The Popover opens upward
 * (side="top") so it clears the bottom edge, and both scroll viewports are
 * `relative` so the TOC can resolve its scroll offsets transform-independently
 * via offsetParent.
 */
const ResponsivePanel: FC<ResponsivePanelProps> = ({
  isMobile,
  title,
  tooltip,
  trigger,
  open,
  onOpenChange,
  children,
}) => {
  // Tooltip is ALWAYS controlled: `false` while its panel is open, otherwise the
  // hover state Radix reports via onOpenChange. Keeping it a stable boolean (never
  // undefined) avoids the Radix "switching from controlled to uncontrolled"
  // warning, which — because the trigger is also the Popover/Drawer trigger —
  // could destabilize pointer handling on the trigger.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipProps = {
    open: open ? false : tooltipOpen,
    onOpenChange: setTooltipOpen,
  };

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <Tooltip {...tooltipProps}>
          <TooltipTrigger asChild>
            <DrawerTrigger asChild>{trigger}</DrawerTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltip}</TooltipContent>
        </Tooltip>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="relative overflow-y-auto px-4 pb-6">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip {...tooltipProps}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="relative max-h-[80vh] w-80 overflow-y-auto p-4"
      >
        <div className="mb-3 text-sm font-medium">{title}</div>
        {children}
      </PopoverContent>
    </Popover>
  );
};

/**
 * Animated chevrons for chapter navigation. The strokes draw themselves in over
 * ~0.4s via SMIL (`stroke-dashoffset` 12 → 0, frozen at the end), so the arrow
 * "writes" itself whenever the icon (re)mounts — on first appearance, and again
 * when the next button swaps back from its loading indicator.
 */
const NavChevronLeft: FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
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
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
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
