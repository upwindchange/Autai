import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { TagRow, ThreadMode } from "@shared/tag";
import { httpClient } from "@/lib/httpClient";
import { useTagStore, type ThreadInfo } from "@/stores/tagStore";
import { useUiStore } from "@/stores/uiStore";
import { useChaptersStore } from "@/stores/chaptersStore";

/**
 * Entertainment's ephemeral thread UI-state. The thread *data* (title, tags,
 * search, multi-select, view-state) lives in the shared {@link useTagStore} so
 * the shared SidebarToolbar keeps working; this store owns only what that
 * shared layer cannot — the active thread selection and the load/refresh
 * lifecycle for the entertainment-mode thread set.
 *
 * Backend DB is the single source of truth for thread identity: every
 * `activeThreadId` is a real backend row id, created server-side via
 * `ensureThread` (POST /threads), never minted on the client. `activeThreadId`
 * is null while the wizard is open with no backing thread yet — the wizard IS
 * the empty state. A thread is created only at the wizard's StepNovel commit,
 * never by a read (load/refresh), which is what makes the duplicate-thread race
 * structurally impossible.
 */

interface EntertainmentThreadsState {
  /** Real backend thread id, or null while the wizard is the empty state (no
   *  thread created yet). Never client-minted. */
  activeThreadId: string | null;
  /** True while the initial thread-list load is in flight. */
  loading: boolean;

  setActiveThreadId: (id: string | null) => void;
  /** Abandon the current thread and open a fresh wizard: reset the reader cache
   *  and clear the active thread. Synchronous and POST-free — it creates NO
   *  thread (creation happens at the wizard's StepNovel commit via ensureThread). */
  abandon: () => void;
  /** The SINGLE user-gestured creation path. Creates a backend entertainment
   *  thread (POST /threads) only when there is no active thread, then returns
   *  its id. Idempotent + race-free: concurrent callers share one in-flight POST. */
  ensureThread: () => Promise<string>;
  /** Initial load on entering entertainment: populate the sidebar thread list
   *  (tagStore). Never selects or opens a thread — the wizard is the default
   *  landing state; the user opens a thread by clicking it in the sidebar. */
  load: () => Promise<void>;
  /** Re-fetch into tagStore (so the sidebar stays current); leave a null active
   *  id alone (a draft in progress), or pick a replacement if the active thread
   *  was deleted. Pure read — never creates. */
  refresh: () => Promise<void>;
}

/** GET /threads?mode=entertainment → populate the shared tagStore. Returns
 *  the threads for refresh()'s active-id reconciliation. */
async function fetchEntertainmentThreads(): Promise<ThreadInfo[]> {
  const data = await httpClient.getJSON<{
    threads: {
      id: string;
      title: string;
      status: "regular" | "archived";
      mode: ThreadMode;
      tags: TagRow[];
    }[];
  }>(`/threads?mode=entertainment`);

  const threadTags: Record<string, TagRow[]> = {};
  const threads: ThreadInfo[] = [];
  for (const t of data.threads) {
    threadTags[t.id] = t.tags;
    threads.push({
      id: t.id,
      title: t.title,
      tags: t.tags,
      status: t.status,
      mode: t.mode,
    });
  }
  useTagStore.getState().setThreadTags(threadTags, threads);
  // Refresh tag definitions alongside thread data (covers a metadata update that
  // added/renamed tags since the last load).
  await useTagStore.getState().fetchTags();
  return threads;
}

// Dedup token for ensureThread: a fast double-click (or two concurrent callers)
// shares one in-flight POST /threads so exactly one thread is created.
let ensureThreadInFlight: Promise<string> | null = null;

export const useEntertainmentThreadsStore = create<EntertainmentThreadsState>()(
  subscribeWithSelector((set, get) => ({
    activeThreadId: null,
    loading: false,

    setActiveThreadId: (id) => {
      set({ activeThreadId: id });
      if (id) {
        useUiStore.getState().setLastActiveByMode("entertainment", id);
      }
    },

    abandon: () => {
      useChaptersStore.getState().reset();
      set({ activeThreadId: null });
    },

    ensureThread: async () => {
      const existing = get().activeThreadId;
      if (existing) return existing;
      if (ensureThreadInFlight) return ensureThreadInFlight;
      ensureThreadInFlight = (async () => {
        const { id } = await httpClient.postJSON<{ id: string }>("/threads", {
          mode: "entertainment",
        });
        get().setActiveThreadId(id);
        return id;
      })().finally(() => {
        ensureThreadInFlight = null;
      });
      return ensureThreadInFlight;
    },

    load: async () => {
      set({ loading: true });
      try {
        await fetchEntertainmentThreads();
      } finally {
        set({ loading: false });
      }
    },

    refresh: async () => {
      const threads = await fetchEntertainmentThreads();
      const current = get().activeThreadId;
      // null = a fresh wizard / draft in progress. An SSE refresh must never
      // yank it onto another thread — this guard is the structural fix for the
      // duplicate-thread / draft-hijack race (reads never mutate null -> thread).
      if (!current) return;
      if (threads.some((t) => t.id === current)) return; // still present

      // The active thread was deleted — pick a replacement from the EXISTING
      // list, or fall back to the wizard. Never create.
      const lastActive = useUiStore.getState().lastActiveByMode.entertainment;
      if (lastActive && threads.some((t) => t.id === lastActive)) {
        set({ activeThreadId: lastActive });
      } else if (threads.length > 0) {
        set({ activeThreadId: threads[0]!.id });
      } else {
        set({ activeThreadId: null });
      }
    },
  })),
);
