import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  Download,
  Link2,
  List,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
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
import { isValidHttpUrl } from "@shared";
import { getApiBase } from "@/lib/api";
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState(false);

  // entertainment tree, so the active thread is already loaded). Chapter jumps
  // (TOC + bookmarks) go through `onJumpTo`, owned by the reader host.
  const chapters = useChaptersStore((s) => s.chapters);
  const currentChapterNumber = useChaptersStore((s) => s.currentChapterNumber);
  const currentThreadId = useChaptersStore((s) => s.currentThreadId);
  const loadChapters = useChaptersStore((s) => s.loadChapters);
  const finalChapterNumber = useChaptersStore((s) => s.finalChapterNumber);
  const novelType = useChaptersStore((s) => s.novelType);

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
    moreOpen;

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

  // --- More menu: process / chapter link / reset / stop --------------------
  // "Process next N" and "Process all" were one action all along (the
  // scheduler resumes from the current read position to the end of the
  // book; the old count spinner was never read) — one honest menu item.
  const handleProcessResume = () => {
    if (!currentThreadId) return;
    void useChaptersStore
      .getState()
      .resumeThread(currentThreadId)
      .then(() => setMoreOpen(false));
  };
  // Errored chapters (source or rewrite "error") — drives the Redo item's
  // enable state + label count.
  const failedCount = chapters.filter(
    (c) => c.sourceStatus === "error" || c.rewriteStatus === "error",
  ).length;
  const handleReprocessFailed = () => {
    if (!currentThreadId) return;
    void useChaptersStore
      .getState()
      .reprocessFailed(currentThreadId)
      .then(() => setMoreOpen(false));
  };

  // Reset: forget the book's site knowledge (blocklist, anchors, stored
  // chapter urls, search cache) so the next fetch re-anchors from scratch.
  const handleResetSources = () => {
    if (!currentThreadId) return;
    void useChaptersStore
      .getState()
      .resetSources(currentThreadId)
      .then(() => setMoreOpen(false));
  };

  // --- Chapter-link override (internet novels) ----------------------------
  // The user pastes the page they are reading; the fetch restarts from the
  // reader cursor's chapter using their URL — no search, no verification.
  const handleSubmitCurrentUrl = async () => {
    if (!currentThreadId) return;
    const url = urlInput.trim();
    if (!isValidHttpUrl(url)) {
      setUrlError(true);
      return;
    }
    try {
      await useChaptersStore.getState().submitCurrentUrl(currentThreadId, url);
      setUrlInput("");
      setUrlError(false);
      setMoreOpen(false);
    } catch {
      setUrlError(true);
    }
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
                <NavChevron direction="left" className="size-4" />
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
              : <NavChevron direction="right" className="size-4" />}
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

          {/* More actions (right) — the pipeline controls that used to be
              standalone footer buttons, grouped into one menu so the pill
              stays lean: process, chapter link (submenu, internet only),
              reset site knowledge, stop. */}
          <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("reader.more.label")}
                    className="size-9 rounded-full"
                  >
                    <MoreHorizontal className="size-5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t("reader.more.label")}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" align="end" className="w-64">
              <DropdownMenuItem
                onClick={handleProcessResume}
                disabled={currentChapterNumber == null}
              >
                <Sparkles />
                {finalChapterNumber != null ?
                  t("reader.process.toEnd", { n: finalChapterNumber })
                : t("reader.process.all")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleReprocessFailed}
                disabled={failedCount === 0}
              >
                <RefreshCw />
                {t("reader.process.retryFailed", { count: failedCount })}
              </DropdownMenuItem>
              {novelType === "internet" && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Link2 />
                    {t("reader.currentUrl.title")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-72">
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t("reader.currentUrl.desc")}
                    </p>
                    <div className="flex flex-col gap-2 p-2">
                      <input
                        type="url"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && urlInput.trim()) {
                            void handleSubmitCurrentUrl();
                          }
                        }}
                        placeholder={t("reader.currentUrl.placeholder")}
                        aria-label={t("reader.currentUrl.placeholder")}
                        className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      {urlError && (
                        <p className="text-xs text-destructive">
                          {t("reader.currentUrl.invalid")}
                        </p>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        disabled={!urlInput.trim()}
                        onClick={() => void handleSubmitCurrentUrl()}
                      >
                        {t("reader.currentUrl.submit")}
                      </Button>
                    </div>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleResetSources}>
                <RotateCcw />
                {t("reader.reset.label")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onStop}>
                <Square />
                {t("reader.stop.label")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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
        </div>
      </TooltipProvider>
    </div>
  );
};

/**
 * Animated chevron for chapter navigation. The stroke draws itself over
 * ~0.4s via SMIL (stroke-dashoffset 12 → 0, frozen), so the arrow "writes"
 * itself whenever the icon (re)mounts.
 */
const NavChevron: FC<{ className?: string; direction: "left" | "right" }> = ({
  className,
  direction,
}) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path d="M0 0h24v24H0z" fill="none" />
    <path
      stroke="currentColor"
      strokeDasharray="12"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d={direction === "left" ? "M8 12l7 -7M8 12l7 7" : "M16 12l-7 -7M16 12l-7 7"}
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
