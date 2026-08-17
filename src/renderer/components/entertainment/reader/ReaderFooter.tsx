import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  Download,
  List,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Sparkles,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ResponsivePanel } from "@/components/responsive-panel";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { useChaptersStore } from "@/stores/chaptersStore";
import { useBookmarksStore } from "@/stores/bookmarksStore";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";
import { getApiBase } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { ReaderSettingsPanel } from "./reader-settings/ReaderSettingsPanel";
import { TableOfContents } from "./table-of-contents/TableOfContents";
import { Bookmarks } from "./bookmarks/Bookmarks";
import { serverEvents } from "@/lib/serverEvents";

interface ReaderFooterProps {
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Pinned open by a tap/click on the reading surface (mobile + desktop). */
  pinned: boolean;
  /** Hovered: pointer is in the bottom reveal band (desktop only). */
  hovered: boolean;
  /** Current within-chapter scroll percentile (0–100), captured into a bookmark anchor. */
  getScrollPercentile: () => number;
  /** Jump to a chapter at a within-chapter percentile (0 = top). The TOC and
   *  prev/next jump through here too (percentile 0 → top) so all chapter
   *  changes share one path. */
  onJumpTo: (chapterNumber: number, percentile: number) => void;
  /** Drop the current thread and open a fresh wizard. */
  onStop: () => void;
  /** Open the full-page rewrite-options editor (replaces the reader, like the wizard). */
  onOpenOptions: () => void;
}

/**
 * Unified bottom reader footer: settings • prev/next • toc, centered and
 * symmetric. Hidden by default; reveals on desktop hover (bottom reveal band) or
 * a surface tap (`pinned`), and hides again when the pointer leaves or the
 * surface is tapped a second time. Settings/TOC open as a Popover (desktop) or
 * bottom-sheet Drawer (mobile). While visible, the chapter list is refreshed
 * via SSE push when chapter data changes, so the TOC and next-chapter
 * indicator stay fresh without polling.
 */
export const ReaderFooter: FC<ReaderFooterProps> = ({
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  pinned,
  hovered,
  getScrollPercentile,
  onJumpTo,
  onStop,
  onOpenOptions,
}) => {
  const { t } = useTranslation("reader");
  const zenMode = useUiStore((s) => s.zenMode);
  const toggleZenMode = useUiStore((s) => s.toggleZenMode);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);
  const [processCount, setProcessCount] = useState(5);

  // TOC data comes from the chapters store (this footer lives inside the
  // entertainment tree, so the active thread is already loaded). Chapter jumps
  // (TOC + bookmarks) go through `onJumpTo`, owned by the reader host.
  const chapters = useChaptersStore((s) => s.chapters);
  const currentChapterNumber = useChaptersStore((s) => s.currentChapterNumber);
  const currentThreadId = useChaptersStore((s) => s.currentThreadId);
  const loadChapters = useChaptersStore((s) => s.loadChapters);
  const finalChapterNumber = useChaptersStore((s) => s.finalChapterNumber);

  // Bookmarks for the active thread. Loaded once per thread switch (no poll —
  // bookmarks only change via this client); add/remove mutate the store directly.
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const loadBookmarks = useBookmarksStore((s) => s.loadBookmarks);
  const addBookmark = useBookmarksStore((s) => s.addBookmark);
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark);

  const visible =
    pinned ||
    hovered ||
    settingsOpen ||
    tocOpen ||
    bookmarksOpen ||
    downloadOpen ||
    processOpen;

  // Event-driven chapter refresh: refetch the chapter list only when the
  // backend reports a change (SSE push), not on a blind timer. The store's
  // diff guard (sameChapterView) already skips re-renders when the data is
  // unchanged, so this eliminates both unnecessary fetches AND the
  // parse/reducer work that caused the jank.
  useEffect(() => {
    if (!visible || !currentThreadId) return;

    // Initial fetch on visibility — picks up current state.
    void loadChapters(currentThreadId);

    // Refetch when the backend reports a chapter change for this thread.
    // The loading guard prevents concurrent fetches; the next event
    // self-corrects any change missed during an in-flight fetch.
    const dispose = serverEvents.on(
      "entertainment:chaptersChanged",
      (payload) => {
        if (payload.threadId !== currentThreadId) return;
        if (useChaptersStore.getState().loading) return;
        void loadChapters(currentThreadId);
      },
    );

    // Catch up on any events missed during an SSE reconnect gap.
    const disposeReconnect = serverEvents.onReconnect(() => {
      void loadChapters(currentThreadId);
    });

    return () => {
      dispose();
      disposeReconnect();
    };
  }, [visible, currentThreadId, loadChapters]);

  // Load bookmarks once per thread switch (no poll — they only change via this
  // client; add/remove mutate the store directly).
  useEffect(() => {
    if (!currentThreadId) return;
    void loadBookmarks(currentThreadId);
  }, [currentThreadId, loadBookmarks]);

  // Next chapter's phase — derived on the backend (same `status.phase` the TOC
  // renders). Swap the chevron for a dot only while it's actively working
  // (acquiring 原文 or rewriting); success/stopped/error keep the chevron.
  const next = chapters.find(
    (c) => c.chapterNumber === (currentChapterNumber ?? 0) + 1,
  );
  const nextPhase =
    next?.status.phase === "searching" || next?.status.phase === "loading" ?
      next.status.phase
    : null;

  // Jumping via the TOC goes through the host's shared jump path (percentile 0 →
  // chapter top), then closes the TOC so the reader takes over (e-reader
  // convention: pick a chapter → read it).
  const handleSelect = (n: number) => {
    onJumpTo(n, 0);
    setTocOpen(false);
  };

  // Bookmark a spot at the current scroll position; keep the panel open so the
  // new entry appears at the top of the list.
  const handleAddBookmark = () => {
    if (!currentThreadId || currentChapterNumber == null) return;
    void addBookmark(currentThreadId, {
      chapterNumber: currentChapterNumber,
      percentile: getScrollPercentile(),
    });
  };

  const handleDeleteBookmark = (id: string) => {
    if (!currentThreadId) return;
    void removeBookmark(currentThreadId, id);
  };

  // --- Download (export) ---------------------------------------------------
  // Export ranges gate on what's been rewritten, so ranges with nothing ready
  // grey out. The footer already polls `chapters` while visible. The browser
  // streams the file via a same-origin <a download> (server sets
  // Content-Disposition) — no fetch/Blob needed.
  const readyChapters = chapters.filter((c) => c.rewriteStatus === "rewritten");
  const hasAnyReady = readyChapters.length > 0;
  const currentReady =
    currentChapterNumber != null &&
    readyChapters.some((c) => c.chapterNumber === currentChapterNumber);
  const hasReadyFromCurrent =
    currentChapterNumber != null &&
    readyChapters.some((c) => c.chapterNumber >= currentChapterNumber);

  const downloadOptions = [
    {
      range: "current",
      label: t("reader.download.current"),
      disabled: !currentReady,
    },
    {
      range: "fromCurrent",
      label: t("reader.download.fromCurrent"),
      disabled: !hasReadyFromCurrent,
    },
    { range: "all", label: t("reader.download.all"), disabled: !hasAnyReady },
  ] as const;

  const triggerDownload = (range: "current" | "fromCurrent" | "all") => {
    if (!currentThreadId) return;
    const a = document.createElement("a");
    a.href = `${getApiBase()}/entertainment/threads/${currentThreadId}/export?range=${range}&chapter=${currentChapterNumber ?? 1}`;
    a.download = ""; // empty → use the server's Content-Disposition filename
    document.body.appendChild(a);
    a.click();
    a.remove();
    setDownloadOpen(false);
  };

  // --- Process (next N / all / redo failed) --------------------------------
  const handleProcessNext = () => {
    // "Process next N" and "Process all" both resume: the scheduler runs from
    // the current read position to the end of the book. N is UI state only.
    if (!currentThreadId) return;
    void useChaptersStore
      .getState()
      .resumeThread(currentThreadId)
      .then(() => setProcessOpen(false));
  };
  const handleProcessAll = () => {
    if (!currentThreadId) return;
    void useChaptersStore
      .getState()
      .resumeThread(currentThreadId)
      .then(() => setProcessOpen(false));
  };
  // Errored chapters (source or rewrite "error") — drives the Redo button's
  // enable state + label count.
  const failedCount = chapters.filter(
    (c) => c.sourceStatus === "error" || c.rewriteStatus === "error",
  ).length;
  const handleReprocessFailed = () => {
    if (!currentThreadId) return;
    void useChaptersStore
      .getState()
      .reprocessFailed(currentThreadId)
      .then(() => setProcessOpen(false));
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
      <Bookmark
        className={cn("size-5", currentHasBookmark && "text-primary")}
      />
    </Button>
  );

  const downloadTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={!hasAnyReady}
      aria-label={t("reader.download.title")}
      className="size-9 rounded-full"
    >
      <Download className="size-5" />
    </Button>
  );

  const processTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("reader.process.title")}
      className="size-9 rounded-full"
    >
      <Sparkles className="size-5" />
    </Button>
  );

  // Options button — opens the full-page rewrite-options editor (replaces the
  // reader, like the wizard). Not a popover: the dense tactics grid is
  // unreadable in an overlay. Wrapped in a tooltip like the other controls.
  const optionsTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onOpenOptions}
      aria-label={t("reader.options.open")}
      className="size-9 rounded-full"
    >
      <SlidersHorizontal className="size-5" />
    </Button>
  );

  // Drop the current thread and open a fresh wizard. Tooltip-wrapped like the
  // zen toggle (no panel). The switch is synchronous (abandon), so no spinner.
  const stopTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onStop}
      aria-label={t("reader.stop.label")}
      className="size-9 rounded-full"
    >
      <Square className="size-5 fill-current" />
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
            title={t("reader.title")}
            tooltip={t("reader.openSettings")}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            trigger={settingsTrigger}
          >
            <ReaderSettingsPanel />
          </ResponsivePanel>

          {/* Download (left) — export rewritten chapters as .txt. Same
              responsive shell as the other reader panels: Popover on desktop,
              bottom-sheet Drawer on mobile. */}
          <ResponsivePanel
            title={t("reader.download.title")}
            tooltip={t("reader.download.title")}
            open={downloadOpen}
            onOpenChange={setDownloadOpen}
            trigger={downloadTrigger}
          >
            <div className="flex flex-col gap-1">
              {downloadOptions.map((opt) => (
                <button
                  key={opt.range}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => triggerDownload(opt.range)}
                  className={cn(
                    "flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors",
                    opt.disabled ?
                      "cursor-not-allowed text-muted-foreground/50"
                    : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </ResponsivePanel>

          {/* Process next N / all (left) */}
          <ResponsivePanel
            title={t("reader.process.title")}
            tooltip={t("reader.process.title")}
            open={processOpen}
            onOpenChange={setProcessOpen}
            trigger={processTrigger}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  {t("reader.process.countLabel")}
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={processCount}
                    onChange={(e) =>
                      setProcessCount(
                        Math.max(1, Math.floor(Number(e.target.value) || 1)),
                      )
                    }
                    aria-label={t("reader.process.countLabel")}
                    className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-sm tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleProcessNext}
                    disabled={currentChapterNumber == null}
                  >
                    {t("reader.process.next")}
                  </Button>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleProcessAll}
                disabled={currentChapterNumber == null}
              >
                {finalChapterNumber != null ?
                  t("reader.process.toEnd", { n: finalChapterNumber })
                : t("reader.process.all")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReprocessFailed}
                disabled={failedCount === 0}
              >
                {t("reader.process.retryFailed", { count: failedCount })}
              </Button>
            </div>
          </ResponsivePanel>

          {/* Options (left) — full-page rewrite-options editor (not a popover). */}
          <Tooltip>
            <TooltipTrigger asChild>{optionsTrigger}</TooltipTrigger>
            <TooltipContent side="top">
              {t("reader.options.open")}
            </TooltipContent>
          </Tooltip>

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
                <DotMatrix state={nextPhase} className="size-5" />
              : <NavChevronRight className="size-4" />}
            </Button>
          </div>

          {/* TOC (right) */}
          <ResponsivePanel
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
              onJump={(b) => {
                onJumpTo(b.chapterNumber, b.anchor?.percentile ?? 0);
                setBookmarksOpen(false);
              }}
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

          {/* Stop (right edge) */}
          <Tooltip>
            <TooltipTrigger asChild>{stopTrigger}</TooltipTrigger>
            <TooltipContent side="top">{t("reader.stop.hint")}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
};

/**
 * Animated chevrons for chapter navigation. The strokes draw themselves over
 * ~0.4s via SMIL (stroke-dashoffset 12 → 0, frozen), so the arrow "writes"
 * itself whenever the icon (re)mounts.
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
