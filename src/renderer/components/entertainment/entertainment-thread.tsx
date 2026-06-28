import "streamdown/styles.css";
// NOTE: katex css is intentionally NOT imported — the math plugin is disabled.
import "./novel-reader.css"; // scoped novel-reading typography
import { useEffect, useRef, type FC } from "react";
import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useUiStore } from "@/stores/uiStore";
import { useReaderSettings } from "@/stores/readerSettingsStore";
import { useChaptersStore, type ChapterView } from "@/stores/chaptersStore";
import { useChapterReadiness } from "@/hooks/useChapterReadiness";
import { NovelText } from "./NovelText";
import { EntertainmentWizard } from "./EntertainmentWizard";
import { buildReaderCssVars } from "./reader-settings/reader-theme";
import { ReaderControlsButton } from "./reader-settings/ReaderControlsButton";
import { ChapterNav } from "./chapter-nav/ChapterNav";

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

  const chapters = useChaptersStore((s) => s.chapters);
  const currentChapterNumber = useChaptersStore((s) => s.currentChapterNumber);
  const novelType = useChaptersStore((s) => s.novelType);
  const loadChapters = useChaptersStore((s) => s.loadChapters);
  const getPosition = useChaptersStore((s) => s.getPosition);
  const setPosition = useChaptersStore((s) => s.setPosition);
  const ensureWorker = useChaptersStore((s) => s.ensureWorker);
  const setCurrentChapter = useChaptersStore((s) => s.setCurrentChapter);

  const viewportRef = useRef<HTMLDivElement>(null);

  // Recovery + initial load: on thread switch, load chapters + resume position,
  // then ensure the worker for that chapter (point 9 — same path as activation).
  useEffect(() => {
    if (!mainThreadId) return;
    void (async () => {
      await loadChapters(mainThreadId);
      const pos = await getPosition(mainThreadId);
      const store = useChaptersStore.getState();
      const hasChapters = store.chapters.length > 0;
      if (pos != null) {
        setCurrentChapter(pos);
        void ensureWorker(mainThreadId, pos);
      } else if (hasChapters) {
        setCurrentChapter(1);
        void ensureWorker(mainThreadId, 1);
      }
      // else: fresh thread — the wizard drives the first chapter.
    })();
  }, [
    mainThreadId,
    loadChapters,
    getPosition,
    ensureWorker,
    setCurrentChapter,
  ]);

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

  // Start each displayed chapter at the top.
  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [currentChapterNumber]);

  // Wizard only on a fresh thread (no chapters, nothing started yet).
  const showWizard = chapters.length === 0 && currentChapterNumber == null;

  const handlePrev = async () => {
    if (!mainThreadId || !canGoPrev || currentChapterNumber == null) return;
    const prev = currentChapterNumber - 1;
    setCurrentChapter(prev);
    void setPosition(mainThreadId, prev);
  };

  const handleNext = async () => {
    if (!mainThreadId || !canGoNext || currentChapterNumber == null) return;
    const next = currentChapterNumber + 1;
    setCurrentChapter(next);
    void setPosition(mainThreadId, next);
    void ensureWorker(mainThreadId, next); // snappy; the hook re-ensures too
  };

  return (
    <ThreadPrimitive.Root
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
        scrollToBottomOnRunStart={false}
        scrollToBottomOnInitialize={false}
        scrollToBottomOnThreadSwitch={false}
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scroll-smooth"
      >
        <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
          {showWizard && <EntertainmentWizard />}

          {currentChapterNumber != null && (
            <div
              data-slot="aui_message-group"
              className="mb-10 flex flex-col gap-y-10 empty:hidden"
            >
              <ChapterBody chapter={current} />
            </div>
          )}
        </div>
      </ThreadPrimitive.Viewport>
      {currentChapterNumber != null && (
        <>
          <ChapterNav
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            fetching={false}
            onPrev={() => void handlePrev()}
            onNext={() => void handleNext()}
          />
          <ReaderControlsButton />
        </>
      )}
    </ThreadPrimitive.Root>
  );
};

/** Renders the current chapter by its pipeline status (never shows 原文). */
const ChapterBody: FC<{ chapter: ChapterView | undefined }> = ({ chapter }) => {
  if (
    !chapter ||
    chapter.sourceStatus === null ||
    chapter.sourceStatus === "fetching"
  ) {
    return <ChapterState icon keyLabel="reader.chapter.fetching" />;
  }
  if (chapter.sourceStatus === "error" || chapter.rewriteStatus === "error") {
    return <ChapterState textLabel="reader.chapter.error" />;
  }
  if (chapter.rewriteStatus !== "rewritten") {
    return <ChapterState icon keyLabel="reader.chapter.rewriting" />;
  }
  return <NovelText content={chapter.content ?? ""} />;
};

/** Fetching/rewriting/error placeholder. */
const ChapterState: FC<{
  icon?: boolean;
  keyLabel?: string;
  textLabel?: string;
}> = ({ icon, keyLabel, textLabel }) => {
  const { t } = useTranslation("reader");
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
      {icon && <Loader2 className="size-6 animate-spin" />}
      <p className="text-sm">{t(keyLabel ?? textLabel ?? "")}</p>
    </div>
  );
};
