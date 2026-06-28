import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  ChapterDetail,
  ChapterProgress,
  EntertainmentConfig,
} from "@shared";
import { httpClient } from "@/lib/httpClient";

/**
 * Entertainment reader store — the reader's source of truth.
 *
 * Polling-driven, NOT event-driven: there is NO SSE subscription for chapters.
 * The `useChapterReadiness` hook polls chapter detail + worker liveness and
 * writes results back here. The DB status columns are the single source of
 * truth; this store is just a cache the reader renders from.
 */
export interface ChapterView extends ChapterProgress {
  // Cached rewritten prose (undefined = not fetched yet; null = not rewritten).
  content?: string | null;
}

export interface WorkerInfo {
  active: boolean;
  target: number;
  pending: number;
  size: number;
}

interface ChaptersState {
  currentThreadId: string | null;
  chapters: ChapterView[]; // sorted by chapterNumber
  currentChapterNumber: number | null;
  novelType: "file" | "internet" | null;
  loading: boolean;

  /** Re-read the chapter list (statuses); preserves cached content. */
  loadChapters: (threadId: string) => Promise<void>;
  /** Re-read one chapter's detail (statuses + content) and merge it in. */
  loadChapterDetail: (
    threadId: string,
    n: number,
  ) => Promise<ChapterDetail | undefined>;
  /** Internet wizard submit: save config + set up the thread. */
  setupInternet: (threadId: string, config: EntertainmentConfig) => Promise<void>;
  /** File wizard submit: upload (backend detects encoding + ingests + starts rewrite). */
  uploadFile: (
    threadId: string,
    config: EntertainmentConfig,
    payload: { fsPath?: string; fileBytesBase64?: string },
  ) => Promise<void>;
  /** Query the per-thread worker's liveness. */
  queryWorker: (threadId: string) => Promise<WorkerInfo>;
  /** Ensure a worker is processing chapter n's window (start-if-absent). */
  ensureWorker: (threadId: string, n: number) => Promise<WorkerInfo>;
  /** Last-read chapter (for resume-on-reopen). */
  getPosition: (threadId: string) => Promise<number | null>;
  /** Persist the reader's current chapter. */
  setPosition: (threadId: string, n: number) => Promise<void>;
  setCurrentChapter: (n: number | null) => void;
}

export const useChaptersStore = create<ChaptersState>()(
  subscribeWithSelector((set) => ({
    currentThreadId: null,
    chapters: [],
    currentChapterNumber: null,
    novelType: null,
    loading: false,

    loadChapters: async (threadId) => {
      set({ loading: true });
      try {
        const { chapters, novelType } = await httpClient.getJSON<{
          chapters: ChapterProgress[];
          novelType: "file" | "internet" | null;
        }>(`/entertainment/threads/${threadId}/chapters`);
        set((state) => {
          const prevByNum = new Map(
            state.chapters.map((c) => [c.chapterNumber, c]),
          );
          return {
            currentThreadId: threadId,
            novelType,
            chapters: chapters.map((c) => {
              const prev = prevByNum.get(c.chapterNumber);
              return prev ? { ...c, content: prev.content } : { ...c };
            }),
            loading: false,
          };
        });
      } catch {
        set({ loading: false });
      }
    },

    loadChapterDetail: async (threadId, n) => {
      try {
        const { chapter } = await httpClient.getJSON<{ chapter: ChapterDetail }>(
          `/entertainment/threads/${threadId}/chapters/${n}`,
        );
        set((state) => {
          // Upsert: a network chapter may not be in the list yet (no source row).
          const exists = state.chapters.some(
            (c) => c.chapterNumber === n,
          );
          const merged: ChapterView = { ...chapter, content: chapter.content };
          const next = exists ?
              state.chapters.map((c) =>
                c.chapterNumber === n ? merged : c,
              )
            : [...state.chapters, merged].sort(
                (a, b) => a.chapterNumber - b.chapterNumber,
              );
          return { chapters: next };
        });
        return chapter;
      } catch {
        return undefined;
      }
    },

    setupInternet: async (threadId, config) => {
      await httpClient.postJSON(`/entertainment/threads/${threadId}/setup`, {
        config,
      });
    },

    uploadFile: async (threadId, config, payload) => {
      await httpClient.postJSON(`/entertainment/threads/${threadId}/upload`, {
        config,
        ...payload,
      });
    },

    queryWorker: (threadId) =>
      httpClient.getJSON<WorkerInfo>(
        `/entertainment/threads/${threadId}/worker`,
      ),

    ensureWorker: (threadId, n) =>
      httpClient.postJSON<WorkerInfo>(
        `/entertainment/threads/${threadId}/worker`,
        { chapterNumber: n },
      ),

    getPosition: async (threadId) => {
      const { lastChapterNumber } = await httpClient.getJSON<{
        lastChapterNumber: number | null;
      }>(`/entertainment/threads/${threadId}/position`);
      return lastChapterNumber;
    },

    setPosition: (threadId, n) =>
      httpClient.postJSON(`/entertainment/threads/${threadId}/position`, {
        chapterNumber: n,
      }),

    setCurrentChapter: (n) => set({ currentChapterNumber: n }),
  })),
);
