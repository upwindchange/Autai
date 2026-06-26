import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ChapterFull, ChapterSummary, EntertainmentConfig } from "@shared";
import { httpClient } from "@/lib/httpClient";
import { serverEvents } from "@/lib/serverEvents";

/**
 * Entertainment reader store — the single source of truth for the dehydrate
 * reader. There is NO live streaming: the stub worker writes complete chapters
 * to the DB and fires `entertainment:chapterReady`; this store reads every
 * chapter from disk.
 *
 * Resilience model: a thread's "waiting/generating" state is DERIVED from the
 * loaded chapter list (any row with `status: 'streaming'`), never from a
 * volatile flag. `loadChapters` (a REST GET) is the only way the view is
 * populated — on mount, thread switch, after a generation POST, and on a
 * `chapterReady` event for the current thread. Because the waiting state lives
 * in the DB, it survives thread switches, exiting/entering entertainment mode,
 * and reloads. Multiple threads can generate concurrently: the single global
 * `chapterReady` subscription routes by `currentThreadId` (background threads
 * are already correct in the DB and reconcile on switch).
 */
export interface ChapterView extends ChapterSummary {
  // undefined = not fetched yet; null = generating (no prose yet); string = loaded
  content?: string | null;
}

interface ChaptersState {
  currentThreadId: string | null;
  chapters: ChapterView[]; // sorted by chapterNumber
  currentChapterId: string | null; // null = follow the latest chapter
  loading: boolean;

  /** Register the global chapterReady/onReconnect handlers (call once). */
  init: () => void;
  /** Re-read the chapter list from disk; sets currentThreadId. */
  loadChapters: (threadId: string) => Promise<void>;
  /** Fetch one chapter's content and merge it into the list (lazy, on demand). */
  loadChapterContent: (chapterId: string) => Promise<void>;
  /** Start the first chapter of a dehydrate run (wizard submit). */
  startDehydrate: (
    threadId: string,
    config: EntertainmentConfig,
    novelText?: string,
  ) => Promise<void>;
  /** Generate the next chapter (reader "Next" at the latest). */
  nextChapter: (
    threadId: string,
    config?: EntertainmentConfig,
  ) => Promise<void>;
  setCurrentChapter: (id: string | null) => void;
}

let initialized = false;

export const useChaptersStore = create<ChaptersState>()(
  subscribeWithSelector((set, get) => ({
    currentThreadId: null,
    chapters: [],
    currentChapterId: null,
    loading: false,

    init: () => {
      if (initialized) return;
      initialized = true;
      // Single global subscription. Routes by the LIVE currentThreadId so events
      // for background threads are ignored (their DB state is already correct
      // and reconciles when the user switches to them).
      serverEvents.on("entertainment:chapterReady", ({ threadId }) => {
        if (threadId !== get().currentThreadId) return;
        void get().loadChapters(threadId);
      });
      serverEvents.onReconnect(() => {
        const t = get().currentThreadId;
        if (t) void get().loadChapters(t);
      });
    },

    loadChapters: async (threadId: string) => {
      set({ loading: true });
      try {
        const { chapters } = await httpClient.getJSON<{
          chapters: ChapterSummary[];
        }>(`/entertainment/threads/${threadId}/chapters`);
        set((state) => {
          // Preserve already-loaded content + the current pin (if still present).
          const prevById = new Map(state.chapters.map((c) => [c.id, c]));
          const next: ChapterView[] = chapters.map((c) => {
            const prev = prevById.get(c.id);
            return prev ? { ...c, content: prev.content } : { ...c };
          });
          const currentStillPresent =
            state.currentChapterId === null ||
            next.some((c) => c.id === state.currentChapterId);
          return {
            currentThreadId: threadId,
            chapters: next,
            currentChapterId:
              currentStillPresent ? state.currentChapterId : null,
            loading: false,
          };
        });
      } catch {
        set({ loading: false });
      }
    },

    loadChapterContent: async (chapterId: string) => {
      const threadId = get().currentThreadId;
      if (!threadId) return;
      try {
        const { chapter } = await httpClient.getJSON<{ chapter: ChapterFull }>(
          `/entertainment/threads/${threadId}/chapters/${chapterId}`,
        );
        set((state) => ({
          chapters: state.chapters.map((c) =>
            c.id === chapterId ? { ...c, content: chapter.content } : c,
          ),
        }));
      } catch {
        // leave content unloaded; the reader shows its fallback
      }
    },

    startDehydrate: async (
      threadId: string,
      config: EntertainmentConfig,
      novelText?: string,
    ) => {
      if (get().chapters.some((c) => c.status === "streaming")) return;
      await httpClient.postJSON(`/entertainment/threads/${threadId}/chapters`, {
        config,
        novelText,
      });
      // The worker is fire-and-forget; reload to pick up any rows written before
      // the chapterReady event lands (ingestion may already be done).
      await get().loadChapters(threadId);
    },

    nextChapter: async (threadId: string, config?: EntertainmentConfig) => {
      if (get().chapters.some((c) => c.status === "streaming")) return;
      await httpClient.postJSON(
        `/entertainment/threads/${threadId}/chapters`,
        config ? { config } : {},
      );
      await get().loadChapters(threadId);
    },

    setCurrentChapter: (id) => set({ currentChapterId: id }),
  })),
);

/** A thread is "waiting/generating" iff a chapter row is still in progress. */
export const selectWaiting = (s: ChaptersState): boolean =>
  s.chapters.some((c) => c.status === "streaming");
