import { useEffect, useRef, type FC } from "react";
import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { Loader2 } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { useReaderSettings } from "@/stores/readerSettingsStore";
import { selectWaiting, useChaptersStore } from "@/stores/chaptersStore";
import { NovelText } from "./NovelText";
import { EntertainmentWizard } from "./EntertainmentWizard";
import { buildReaderCssVars } from "./reader-settings/reader-theme";
import { ReaderControlsButton } from "./reader-settings/ReaderControlsButton";
import { ChapterNav } from "./chapter-nav/ChapterNav";

/**
 * Entertainment thread — a guided novel-reading surface.
 *
 * DB-backed, not message-backed: the reader's source of truth is the chapters
 * store, which reads every chapter from disk (REST). There is NO live
 * streaming — the stub worker writes complete chapters and fires
 * `entertainment:chapterReady`; the store refreshes the viewed thread on that
 * event. A chapter with `status: 'streaming'` is still being generated, so the
 * reader shows a waiting indicator for it.
 *
 * The reader is PAGINATED: one chapter is shown at a time (pinned via
 * currentChapterId, or "follow the latest" when null).
 *
 * The assistant-ui shell (ThreadPrimitive.Root/Viewport + ThreadIdTracker) is
 * kept only for layout + the active thread id; no assistant-ui messages are
 * used for content.
 */

// --- custom: session tracking ---
// Sync sessionId from the active thread id whenever it changes. (Kept from the
// message-based version; still needed so headers/cookie align with the thread.)
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

  const chapters = useChaptersStore((s) => s.chapters);
  const currentChapterId = useChaptersStore((s) => s.currentChapterId);
  const loadChapters = useChaptersStore((s) => s.loadChapters);
  const loadChapterContent = useChaptersStore((s) => s.loadChapterContent);
  const nextChapter = useChaptersStore((s) => s.nextChapter);
  const setCurrentChapter = useChaptersStore((s) => s.setCurrentChapter);
  const waiting = useChaptersStore(selectWaiting);

  const viewportRef = useRef<HTMLDivElement>(null);

  // Register the global chapterReady/onReconnect handlers once.
  useEffect(() => {
    useChaptersStore.getState().init();
  }, []);

  // (Re)load this thread's chapters from disk whenever the active thread
  // changes — this is what makes the waiting state survive switches/reloads.
  useEffect(() => {
    if (!mainThreadId) return;
    void loadChapters(mainThreadId);
  }, [mainThreadId, loadChapters]);

  const lastChapter = chapters[chapters.length - 1];
  const current =
    currentChapterId ?
      chapters.find((c) => c.id === currentChapterId)
    : lastChapter;
  const currentIndex =
    current ? chapters.findIndex((c) => c.id === current.id) : -1;
  const canGoPrev = currentIndex > 0;

  // Lazy-load the current chapter's prose from disk when it hasn't been fetched
  // yet (and isn't still generating — a streaming row has no content to load).
  useEffect(() => {
    if (
      current &&
      current.content === undefined &&
      current.status !== "streaming"
    ) {
      void loadChapterContent(current.id);
    }
  }, [current, loadChapterContent]);

  // Start each displayed chapter at the top.
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [current?.id]);

  // Wizard only when there are no chapters AND nothing is generating. An empty
  // thread with an in-progress chapter shows the waiting state, not the wizard.
  const showWizard = chapters.length === 0 && !waiting;
  const hasContent = chapters.length > 0 || waiting;

  const handlePrev = () => {
    if (currentIndex <= 0) return;
    setCurrentChapter(chapters[currentIndex - 1]!.id);
  };

  const handleNext = async () => {
    if (waiting) return;
    // Move forward among already-generated chapters without re-generating.
    if (current && currentIndex >= 0 && currentIndex < chapters.length - 1) {
      setCurrentChapter(chapters[currentIndex + 1]!.id);
      return;
    }
    // At the latest: generate the next chapter (disk-backed).
    if (mainThreadId) {
      setCurrentChapter(null); // follow the new chapter as it completes
      await nextChapter(mainThreadId);
    }
  };

  return (
    <ThreadPrimitive.Root
      // `relative` anchors the floating reader-controls button + chapter nav.
      className="aui-root aui-thread-root @container relative flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "88rem",
        ...buildReaderCssVars(settings),
        backgroundColor: "var(--reader-background)",
      }}
    >
      <ThreadIdTracker />
      <ThreadPrimitive.Viewport
        ref={viewportRef}
        turnAnchor="top"
        autoScroll={false}
        // Pagination owns scroll position: every chapter starts at the top.
        scrollToBottomOnRunStart={false}
        scrollToBottomOnInitialize={false}
        scrollToBottomOnThreadSwitch={false}
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scroll-smooth"
      >
        <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
          {showWizard && <EntertainmentWizard />}

          {hasContent && (
            <div
              data-slot="aui_message-group"
              className="mb-10 flex flex-col gap-y-10 empty:hidden"
            >
              {current &&
                (current.status === "streaming" ?
                  <ChapterGenerating title={current.title} />
                : <NovelText content={current.content ?? ""} />)}
            </div>
          )}
        </div>
      </ThreadPrimitive.Viewport>
      {hasContent && (
        <>
          <ChapterNav
            canGoPrev={canGoPrev}
            fetching={waiting}
            onPrev={handlePrev}
            onNext={handleNext}
          />
          <ReaderControlsButton />
        </>
      )}
    </ThreadPrimitive.Root>
  );
};

/** Placeholder shown while a chapter is being generated (status: streaming). */
const ChapterGenerating: FC<{ title: string | null }> = ({ title }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
    <Loader2 className="size-6 animate-spin" />
    {title && <p className="text-sm">{title}</p>}
  </div>
);
