import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  ChapterDetail,
  ChapterStatus,
  ChapterProgress,
  EntertainmentConfig,
} from "@shared";
import { httpClient } from "@/lib/httpClient";

// Pull a short message out of an unknown fetch failure so a failed load isn't
// indistinguishable from "still processing". Used by both store loaders below.
const fetchErrorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

// Shallow comparison of two ChapterStatus objects. `ChapterStatus` is flat
// (phase + messageKey) plus a small optional `messageParams` record, so a
// field-by-field check (with a shallow params sweep) is exact and cheap.
const sameStatus = (
  a: ChapterStatus | undefined,
  b: ChapterStatus | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.phase !== b.phase || a.messageKey !== b.messageKey) return false;
  const ap = a.messageParams;
  const bp = b.messageParams;
  if (ap === bp) return true;
  if (!ap || !bp) return false;
  const ak = Object.keys(ap);
  const bk = Object.keys(bp);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (ap[k] !== bp[k]) return false;
  return true;
};

// Shallow comparison of two ChapterViews. ChapterView is a flat object
// (chapterNumber, title, three status fields, status, content); `status` is a
// small nested object compared via `sameStatus`. Used by the loaders to skip
// `set` when a poll returned byte-identical state, which otherwise allocates
// fresh arrays/objects and re-renders every subscriber.
const sameChapterView = (a: ChapterView, b: ChapterView): boolean =>
  a.chapterNumber === b.chapterNumber &&
  a.title === b.title &&
  a.sourceStatus === b.sourceStatus &&
  a.rewriteStatus === b.rewriteStatus &&
  sameStatus(a.status, b.status) &&
  a.content === b.content;

/**
 * Entertainment reader store — the reader's source of truth.
 *
 * Polling-driven, NOT event-driven: there is NO SSE subscription for chapters.
 * The `useChapterReadiness` hook polls chapter detail + worker liveness and
 * writes results back here. The DB status columns are the single source of
 * truth; this store is just a cache the reader renders from.
 */
export interface ChapterView extends ChapterProgress {
  // Reader-facing status — derived on the backend per chapter (phase +
  // pipeline-aware message key/params). The renderer renders `status.phase`
  // via DotMatrix and `t(status.messageKey, status.messageParams)` for the copy,
  // with NO client-side mapping.
  status: ChapterStatus;
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
  finalChapterNumber: number | null;
  loading: boolean;
  /** Last chapter-list or chapter-detail fetch error, or null when the last
   * fetch succeeded. Surfaced so a failed load isn't silent (and isn't
   * misread by `useChapterReadiness` as "still processing"). */
  error: string | null;

  /** Re-read the chapter list (statuses); preserves cached content. */
  loadChapters: (threadId: string) => Promise<void>;
  /** Re-read one chapter's detail (statuses + content + derived status) and
   *  merge it in. Returns the fetched chapter (with its `status`) or undefined
   *  on fetch failure. */
  loadChapterDetail: (
    threadId: string,
    n: number,
  ) => Promise<(ChapterDetail & { status: ChapterStatus }) | undefined>;
  /** Internet wizard submit: save config + set up the thread. */
  setupInternet: (
    threadId: string,
    config: EntertainmentConfig,
  ) => Promise<void>;
  /** File wizard "Upload & Continue": decode + persist raw text in the
   * background (the dehydrate loop is NOT kicked here — Start does that via
   * ensureWorker → ensureRange). Resolves once raw text is committed to DB. */
  ingestFile: (
    threadId: string,
    config: EntertainmentConfig,
    payload: { fsPath?: string; fileBytesBase64?: string },
  ) => Promise<void>;
  /** Query the per-thread worker's liveness. */
  queryWorker: (threadId: string) => Promise<WorkerInfo>;
  /** Ensure a worker is processing chapter n's window (start-if-absent). */
  ensureWorker: (threadId: string, n: number) => Promise<WorkerInfo>;
  /** Batch-process: next `count` chapters from `from`, or all to the book's end. */
  processChapters: (
    threadId: string,
    opts: { from: number; count?: number; all?: boolean },
  ) => Promise<WorkerInfo>;
  /** Re-enqueue every errored chapter (the "Redo failed chapters" action). */
  reprocessFailed: (threadId: string) => Promise<WorkerInfo>;
  /**
   * Stop ALL in-flight work on a thread — abort the running outline + rewrite
   * agents, drain the pending queue, clear the in-flight set. Called by the
   * reader's "Stop" button before it abandons the thread for a new one. Rows
   * left mid-run self-heal on the next open.
   */
  stopAgents: (threadId: string) => Promise<void>;
  /** Read a thread's persisted entertainment config (seeds the in-flight settings editor). */
  getThreadConfig: (threadId: string) => Promise<EntertainmentConfig | null>;
  /**
   * Update a thread's config mid-run WITHOUT re-running one-time setup. The
   * next agent the pipeline enqueues re-reads config and rebuilds its prompt
   * from the new options (immediate on pipeline ②; ①/③ pick it up once their
   * settings-driven rewriters land). Does NOT touch novelSource/mode semantics.
   */
  updateThreadConfig: (
    threadId: string,
    config: EntertainmentConfig,
  ) => Promise<void>;
  /** Last-read chapter (for resume-on-reopen). */
  getPosition: (threadId: string) => Promise<number | null>;
  /** Persist the reader's current chapter. */
  setPosition: (threadId: string, n: number) => Promise<void>;
  setCurrentChapter: (n: number | null) => void;
  /**
   * Clear all cached chapter state — the thread switch / stop path. The reader
   * component does NOT unmount on thread switch (only `appMode` toggles it), so
   * without this the previous thread's `currentChapterNumber` lingers and blocks
   * the wizard from showing on a fresh thread (`showWizard` requires
   * `currentChapterNumber == null`). Called by `handleStop` before switching to
   * a new thread so the wizard evaluates against a clean slate.
   */
  reset: () => void;
}

export const useChaptersStore = create<ChaptersState>()(
  subscribeWithSelector((set) => ({
    currentThreadId: null,
    chapters: [],
    currentChapterNumber: null,
    novelType: null,
    finalChapterNumber: null,
    loading: false,
    error: null,

    loadChapters: async (threadId) => {
      set({ loading: true });
      try {
        const { chapters, novelType, finalChapterNumber } =
          await httpClient.getJSON<{
            chapters: (ChapterProgress & { status: ChapterStatus })[];
            novelType: "file" | "internet" | null;
            finalChapterNumber: number | null;
          }>(`/entertainment/threads/${threadId}/chapters`);
        set((state) => {
          // The poll fires every 1500ms regardless of activity; without a
          // change-check, a fresh `chapters` array (and fresh chapter objects)
          // is allocated every tick and re-renders every subscriber (reader,
          // TOC, footer) for nothing. Each ChapterView is a flat object, so a
          // shallow field comparison is cheap and exact — skip the set when the
          // polled state is byte-identical to what we already have.
          const prevByNum = new Map(
            state.chapters.map((c) => [c.chapterNumber, c]),
          );
          let changed = false;
          const merged = chapters.map((c) => {
            const prev = prevByNum.get(c.chapterNumber);
            if (!prev) {
              changed = true;
              return { ...c };
            }
            const next: ChapterView = { ...c, content: prev.content };
            if (!sameChapterView(prev, next)) changed = true;
            return next;
          });
          const stateChanged =
            changed ||
            state.currentThreadId !== threadId ||
            state.novelType !== novelType ||
            state.finalChapterNumber !== finalChapterNumber;
          if (!stateChanged) {
            // No chapter data changed — keep every reference identical so
            // chapter subscribers (reader, TOC, footer) don't re-render. But
            // the guard MUST be cleared: this fetch set `loading` true at the
            // top, and the footer's poll tick skips while loading===true.
            // Returning `state` unchanged would wedge loading at true forever,
            // stalling the poll so chapters committed after the first never
            // reach the store (TOC + next-button stuck on chapter 1).
            return state.loading || state.error ?
                { ...state, loading: false, error: null }
              : state;
          }
          return {
            currentThreadId: threadId,
            novelType,
            finalChapterNumber,
            chapters: merged,
            loading: false,
            error: null,
          };
        });
      } catch (err) {
        set({
          loading: false,
          error: fetchErrorMessage(err, "Failed to load chapters"),
        });
      }
    },

    loadChapterDetail: async (threadId, n) => {
      try {
        const { chapter } = await httpClient.getJSON<{
          chapter: ChapterDetail & { status: ChapterStatus };
        }>(`/entertainment/threads/${threadId}/chapters/${n}`);
        set((state) => {
          // Upsert: a network chapter may not be in the list yet (no source row).
          const idx = state.chapters.findIndex((c) => c.chapterNumber === n);
          const merged: ChapterView = { ...chapter, content: chapter.content };
          // Same rationale as loadChapters: the poll fires every 1500ms; skip
          // the set when this chapter's view is unchanged AND error is already
          // null, so the detail poll doesn't re-render subscribers for nothing.
          if (idx >= 0) {
            if (
              sameChapterView(state.chapters[idx], merged) &&
              state.error === null
            )
              return state;
            const next = state.chapters.slice();
            next[idx] = merged;
            return { chapters: next, error: null };
          }
          const next = [...state.chapters, merged].sort(
            (a, b) => a.chapterNumber - b.chapterNumber,
          );
          return { chapters: next, error: null };
        });
        return chapter;
      } catch (err) {
        set({ error: fetchErrorMessage(err, "Failed to load chapter") });
        return undefined;
      }
    },

    setupInternet: async (threadId, config) => {
      await httpClient.postJSON(`/entertainment/threads/${threadId}/setup`, {
        config,
      });
    },

    ingestFile: async (threadId, config, payload) => {
      await httpClient.postJSON(`/entertainment/threads/${threadId}/ingest`, {
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

    processChapters: (threadId, { from, count, all }) =>
      httpClient.postJSON<WorkerInfo>(
        `/entertainment/threads/${threadId}/process`,
        { from, count, all },
      ),

    reprocessFailed: (threadId) =>
      httpClient.postJSON<WorkerInfo>(
        `/entertainment/threads/${threadId}/reprocess-failed`,
        {},
      ),

    stopAgents: (threadId) =>
      httpClient
        .postJSON<{ ok: boolean }>(
          `/entertainment/threads/${threadId}/stop`,
          {},
        )
        .then(() => undefined),

    getThreadConfig: async (threadId) => {
      try {
        const { config } = await httpClient.getJSON<{
          config: EntertainmentConfig;
        }>(`/entertainment/threads/${threadId}/config`);
        return config;
      } catch {
        // 404 (no config) or fetch error — either way nothing to edit.
        return null;
      }
    },

    updateThreadConfig: (threadId, config) =>
      httpClient
        .putJSON<{ ok: boolean }>(`/entertainment/threads/${threadId}/config`, {
          config,
        })
        .then(() => undefined),

    getPosition: async (threadId) => {
      const { lastReadChapterNumber } = await httpClient.getJSON<{
        lastReadChapterNumber: number | null;
      }>(`/entertainment/threads/${threadId}/position`);
      return lastReadChapterNumber;
    },

    setPosition: (threadId, n) =>
      httpClient.postJSON(`/entertainment/threads/${threadId}/position`, {
        chapterNumber: n,
      }),

    setCurrentChapter: (n) => set({ currentChapterNumber: n }),

    reset: () =>
      set({
        currentThreadId: null,
        chapters: [],
        currentChapterNumber: null,
        novelType: null,
        finalChapterNumber: null,
        loading: false,
        error: null,
      }),
  })),
);
