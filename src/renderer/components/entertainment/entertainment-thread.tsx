import "./reader/novel-reader.css"; // scoped novel-reading typography
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FC,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { DotMatrix, type DotMatrixState } from "@/components/assistant-ui/dot-matrix";
import { useUiStore } from "@/stores/uiStore";
import { useReaderSettings } from "@/stores/readerSettingsStore";
import { useChaptersStore, type ChapterView } from "@/stores/chaptersStore";
import { useChapterReadiness } from "@/hooks/useChapterReadiness";
import { useReaderHotkeys } from "@/hooks/useReaderHotkeys";
import { useIsMobile } from "@/hooks/use-mobile";
import { EntertainmentWizard } from "./wizard/EntertainmentWizard";
import { buildReaderCssVars } from "./reader/reader-settings/reader-theme";
import { ReaderFooter } from "./reader/ReaderFooter";

// Desktop-only bottom band (px from the reading viewport's bottom edge) that
// reveals the footer on hover. Invisible — hover is detected via mousemove, not
// an overlay, so the prose stays fully interactive. Tuned to sit just above the
// footer pill on both tall phones and short desktop windows.
const HOVER_BAND_PX = 120;

/**
 * Entertainment thread — a guided novel-reading surface.
 *
 * DB-backed + polling-driven: the reader renders from the chapters store, which
 * polls chapter detail + worker liveness (`useChapterReadiness`). The reader
 * NEVER shows 原文 — it renders fetching / rewriting / ready / error states
 * derived from the source+rewrite statuses, and only the rewritten prose once
 * ready. The assistant-ui shell is kept only for layout + the active thread id.
 */

// Sync sessionId from the active thread id (kept from the message-based version).
function ThreadIdTracker() {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  useEffect(() => {
    if (mainThreadId) {
      useUiStore.getState().setSessionId(mainThreadId);
    }
  }, [mainThreadId]);
  return null;
}

export const EntertainmentThread: FC = () => {
  const settings = useReaderSettings();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const isMobile = useIsMobile();

  const chapters = useChaptersStore((s) => s.chapters);
  const currentChapterNumber = useChaptersStore((s) => s.currentChapterNumber);
  const novelType = useChaptersStore((s) => s.novelType);
  const loadChapters = useChaptersStore((s) => s.loadChapters);
  const getPosition = useChaptersStore((s) => s.getPosition);
  const setPosition = useChaptersStore((s) => s.setPosition);
  const ensureWorker = useChaptersStore((s) => s.ensureWorker);
  const setCurrentChapter = useChaptersStore((s) => s.setCurrentChapter);

  const viewportRef = useRef<HTMLDivElement>(null);
  // Common ancestor of BOTH the reading viewport and the ReaderFooter overlay.
  // The desktop hover listener attaches here, not to the viewport — see the
  // hover effect below for why.
  const rootRef = useRef<HTMLDivElement>(null);
  // A jump records { chapterNumber, percentile } here; the apply layout-effect
  // below scrolls to that percentile once the target chapter's rewritten prose
  // is measurable. Scoped to the target chapter: if the user navigates elsewhere
  // (or the chapter never becomes ready) the pending entry is discarded and
  // never scrolls an unrelated chapter.
  const pendingJumpRef = useRef<{ chapterNumber: number; percentile: number } | null>(null);
  // Pinned open by a tap/click on the reading surface (mobile + desktop); the
  // footer also reveals on desktop hover. See ReaderFooter.
  const [footerPinned, setFooterPinned] = useState(false);
  // Desktop hover state for the footer (driven by the mousemove effect below).
  const [footerHovered, setFooterHovered] = useState(false);

  // Recovery + initial load: on thread switch, load chapters + resume position,
  // then ensure the worker for that chapter. The start chapter is recorded as a
  // pending jump at percentile 0 so the apply effect scrolls it to the top once
  // its prose is ready (the unified jump path — no separate top-reset).
  useEffect(() => {
    if (!mainThreadId) return;
    void (async () => {
      await loadChapters(mainThreadId);
      const pos = await getPosition(mainThreadId);
      const hasChapters = useChaptersStore.getState().chapters.length > 0;
      const start = pos ?? (hasChapters ? 1 : null);
      if (start == null) return; // fresh thread — the wizard drives the first chapter.
      pendingJumpRef.current = { chapterNumber: start, percentile: 0 };
      setCurrentChapter(start);
      void ensureWorker(mainThreadId, start);
    })();
  }, [mainThreadId, loadChapters, getPosition, ensureWorker, setCurrentChapter]);

  // Drive the current chapter to readiness (poll + worker liveness).
  useChapterReadiness(mainThreadId, currentChapterNumber);

  const current =
    currentChapterNumber != null ?
      chapters.find((c) => c.chapterNumber === currentChapterNumber)
    : undefined;

  const maxChapterNumber = chapters.reduce(
    (m, c) => Math.max(m, c.chapterNumber),
    0,
  );
  const canGoPrev = (currentChapterNumber ?? 1) > 1;
  const canGoNext =
    novelType === "internet" ||
    (currentChapterNumber != null && currentChapterNumber < maxChapterNumber);

  // Scroll the reader viewport to a within-chapter percentile (0 = top, 100 =
  // bottom). Instant (not smooth) so it can't race with a reader hotkey fired
  // immediately after — the viewport is scroll-smooth, which would otherwise
  // animate the jump. A chapter that fits the viewport (max <= 0) has only one
  // valid spot, the top.
  const scrollToPercentile = (percentile: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const max = vp.scrollHeight - vp.clientHeight;
    const top = max > 0 ? Math.round((percentile / 100) * max) : 0;
    vp.scrollTo({ top, behavior: "instant" });
  };

  // Current within-chapter scroll position as a percentile (0–100). 0 when the
  // viewport isn't mounted or the chapter fits it. Captured into a bookmark's
  // anchor when the reader saves a spot.
  const getScrollPercentile = (): number => {
    const vp = viewportRef.current;
    if (!vp) return 0;
    const max = vp.scrollHeight - vp.clientHeight;
    if (max <= 0) return 0;
    return Math.min(100, Math.max(0, (vp.scrollTop / max) * 100));
  };

  // Jump to a chapter at a within-chapter percentile — the single entry point
  // for all chapter navigation (TOC, bookmark, prev/next). Records the intent,
  // then same-chapter applies immediately while cross-chapter navigates and lets
  // the apply effect below restore the percentile once the target prose is ready.
  const jumpTo = (chapterNumber: number, percentile: number) => {
    if (!mainThreadId) return;
    pendingJumpRef.current = { chapterNumber, percentile };
    if (chapterNumber === currentChapterNumber) {
      scrollToPercentile(percentile);
      pendingJumpRef.current = null;
      return;
    }
    setCurrentChapter(chapterNumber);
    void setPosition(mainThreadId, chapterNumber);
    void ensureWorker(mainThreadId, chapterNumber);
  };

  // Apply a pending jump once the target chapter's rewritten prose is
  // measurable. useLayoutEffect (not useEffect) so the scroll lands before paint
  // — no top-then-jump flash. Scoped to the target chapter: navigated-elsewhere
  // → discard; not yet rewritten → wait (the deps re-fire when status/content
  // arrive). Clears once applied so a stale percentile never carries into an
  // unrelated chapter.
  useLayoutEffect(() => {
    const pending = pendingJumpRef.current;
    if (!pending) return;
    if (currentChapterNumber !== pending.chapterNumber) {
      pendingJumpRef.current = null; // navigated elsewhere — discard
      return;
    }
    if (current?.rewriteStatus !== "rewritten") return; // wait for content
    scrollToPercentile(pending.percentile);
    pendingJumpRef.current = null; // content ready — jump complete
  }, [currentChapterNumber, current?.rewriteStatus, current?.content]);

  // Desktop hover: reveal the footer when the pointer enters the bottom band of
  // the reading surface, hide when it leaves. The listener is attached to the
  // thread ROOT, not the viewport, because the footer overlay is a SIBLING of
  // the viewport (absolute-positioned on top of it). Tracked against the
  // viewport, moving the pointer onto the pill — which is pointer-events-auto
  // while visible and lives outside the viewport's subtree — would fire the
  // viewport's mouseleave (hovered=false), revert the pill to pointer-events-
  // none, let the next mousemove fall back through to the viewport (hovered=
  // true), and oscillate on every wiggle = the flicker. On the root the pill is
  // a descendant, so the pointer never "leaves" while over it and mousemove
  // keeps firing regardless of the pill's pointer-events state. Detected via
  // mousemove (not an overlay) so text selection / link clicks on the prose are
  // never blocked. Touch has no hover — mobile relies on the tap-to-pin path
  // (handleReadingClick).
  useEffect(() => {
    if (isMobile) return;
    const el = rootRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const fromBottom = el.getBoundingClientRect().bottom - e.clientY;
      setFooterHovered(fromBottom >= 0 && fromBottom < HOVER_BAND_PX);
    };
    const onLeave = () => setFooterHovered(false);
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [isMobile]);

  // Wizard only on a fresh thread (no chapters, nothing started yet).
  const showWizard = chapters.length === 0 && currentChapterNumber == null;

  const handlePrev = () => {
    if (!canGoPrev || currentChapterNumber == null) return;
    jumpTo(currentChapterNumber - 1, 0);
  };

  const handleNext = () => {
    if (!canGoNext || currentChapterNumber == null) return;
    jumpTo(currentChapterNumber + 1, 0);
  };

  // Reader keyboard shortcuts (chapter nav, Space/PageDn scroll, Home/End).
  // Window-level; only active while a chapter is open. See useReaderHotkeys.
  useReaderHotkeys({
    viewportRef,
    onPrev: () => void handlePrev(),
    onNext: () => void handleNext(),
    canGoPrev,
    canGoNext,
    enabled: currentChapterNumber != null,
  });

  // Tap/click the reading surface to toggle the footer (mobile + desktop).
  // Taps on the footer itself or its panels don't reach here (they're siblings
  // of this content area), so the toggle only fires on the prose surface.
  // Selection (drag/long-press) and clicks on links/buttons pass through.
  const handleReadingClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (currentChapterNumber == null) return;
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    if ((e.target as HTMLElement | null)?.closest("a, button")) return;
    setFooterPinned((p) => !p);
  };

  return (
    <ThreadPrimitive.Root
      ref={rootRef}
      className="aui-root aui-thread-root @container relative flex h-full flex-col bg-background"
      style={{
        // Reader CSS vars are defined here so they cascade into the viewport
        // and the prose column below; the root itself stays bg-background so
        // the wizard / options chrome follows the app theme. The reader
        // background is applied on the viewport (see below) — NOT this root —
        // so it spans the full window width. The prose column's width is set
        // purely by side margin (--reader-margin), not a content max-width.
        ...buildReaderCssVars(settings),
      }}
    >
      <ThreadIdTracker />
      <ThreadPrimitive.Viewport
        ref={viewportRef}
        turnAnchor="top"
        autoScroll={false}
        scrollToBottomOnRunStart={false}
        scrollToBottomOnInitialize={false}
        scrollToBottomOnThreadSwitch={false}
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scroll-smooth"
        style={{
          // Reader theme background is scoped to the reading surface and
          // applied on the full-width viewport (not the centered prose column)
          // so the theme color fills the whole window. Only while a chapter is
          // open (currentChapterNumber != null) — a fresh thread's wizard keeps
          // the app theme.
          backgroundColor:
            currentChapterNumber != null ?
              "var(--reader-background)"
            : undefined,
        }}
      >
        {showWizard ? (
          // The wizard is a setup surface, not reading prose, so it's rendered
          // as a direct child of the viewport — it does NOT inherit the prose
          // column's --reader-margin (which would crush it on mobile). Its own
          // container handles width + centering.
          <EntertainmentWizard />
        ) : (
          <div
            onClick={handleReadingClick}
            className="flex w-full flex-1 flex-col pt-4 pb-24"
            // Width is controlled purely by side margin: the prose column fills
            // the viewport edge-to-edge behind the reader background, with
            // symmetric inline padding from --reader-margin. The 40vw cap keeps
            // the column from collapsing on narrow windows; there is no content
            // max-width (increase the margin to narrow the text).
            style={{ paddingInline: "min(var(--reader-margin, 12rem), 40vw)" }}
          >
            {currentChapterNumber != null && (
              <div
                data-slot="aui_message-group"
                className="mb-10 flex flex-col gap-y-10 empty:hidden"
              >
                <ChapterBody chapter={current} />
              </div>
            )}
          </div>
        )}
      </ThreadPrimitive.Viewport>
      {currentChapterNumber != null && (
        <ReaderFooter
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onPrev={() => void handlePrev()}
          onNext={() => void handleNext()}
          pinned={footerPinned}
          hovered={footerHovered}
          getScrollPercentile={getScrollPercentile}
          onJumpTo={jumpTo}
        />
      )}
    </ThreadPrimitive.Root>
  );
};

/** Renders the current chapter by its pipeline status (never shows 原文).
 *  Ready prose is rendered as plain <p> paragraphs — no markdown pipeline — so
 *  a multi-thousand-character chapter mounts in milliseconds. Typography
 *  (font, line-height, 2-em first-line indent, paragraph spacing) comes from
 *  the `.novel-reader` rules in novel-reader.css. */
const ChapterBody: FC<{ chapter: ChapterView | undefined }> = ({ chapter }) => {
  if (
    !chapter ||
    chapter.sourceStatus === null ||
    chapter.sourceStatus === "fetching"
  ) {
    return <ChapterState state="loading" keyLabel="reader.chapter.fetching" />;
  }
  if (chapter.sourceStatus === "error" || chapter.rewriteStatus === "error") {
    return <ChapterState textLabel="reader.chapter.error" />;
  }
  if (chapter.rewriteStatus !== "rewritten") {
    return (
      <ChapterState state="uploading" keyLabel="reader.chapter.rewriting" />
    );
  }
  // Split on newline (handles CRLF); blank lines add no node. Each <p> gets the
  // first-line indent + spacing from .novel-reader p. Plain text nodes only,
  // so React/Blink handles a chapter as a handful of elements.
  const paragraphs = (chapter.content ?? "").split(/\r?\n/);
  return (
    <div className="novel-reader text-pretty">
      {paragraphs.map((line, i) =>
        line.trim() ? <p key={i}>{line}</p> : null,
      )}
    </div>
  );
};

/** Fetching/rewriting/error placeholder. `state` selects the indicator phase. */
const ChapterState: FC<{
  state?: DotMatrixState;
  keyLabel?: string;
  textLabel?: string;
}> = ({ state, keyLabel, textLabel }) => {
  const { t } = useTranslation("reader");
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
      {state && <DotMatrix state={state} className="size-6" />}
      <p className="text-sm">{t(keyLabel ?? textLabel ?? "")}</p>
    </div>
  );
};
