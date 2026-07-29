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
 * shared layer cannot — the active thread selection, the wizard step, and the
 * load/refresh lifecycle for the entertainment-mode thread set.
 *
 * The backend DB is the single source of truth for thread identity: every
 * `activeThreadId` is a real backend row id (created server-side via
 * POST /threads), never minted on the client.
 */

interface EntertainmentThreadsState {
  /** Real backend thread id, or null only transiently. Never client-minted. */
  activeThreadId: string | null;
  /** Current wizard step (0..2). Owned here so the wizard's step is part of the
   *  entertainment UI state rather than scattered in component-local state. */
  wizardStep: number;
  /** True while the initial thread-list load is in flight. */
  loading: boolean;

  setActiveThreadId: (id: string | null) => void;
  // Accepts a value or a useState-style functional updater, so the wizard can
  // treat it exactly like a local setStep.
  setWizardStep: (step: number | ((prev: number) => number)) => void;
  /** Reset the reader + create a fresh backend entertainment thread for a new
   *  wizard. The id is generated server-side. */
  startNewWizard: () => Promise<void>;
  /** Initial load on entering entertainment: populate tagStore + reconcile the
   *  active thread (restore last-active, else most-recent, else new wizard). */
  load: () => Promise<void>;
  /** Re-fetch into tagStore; recover the active thread if it was deleted. */
  refresh: () => Promise<void>;
}

/** GET /threads?mode=entertainment → populate the shared tagStore. Returns the
 *  threads so callers can reconcile the active id. Mirrors what the chat
 *  adapter's list() does, but pinned to entertainment. */
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

export const useEntertainmentThreadsStore = create<EntertainmentThreadsState>()(
  subscribeWithSelector((set, get) => ({
    activeThreadId: null,
    wizardStep: 0,
    loading: false,

    setActiveThreadId: (id) => {
      set({ activeThreadId: id });
      if (id) {
        useUiStore.getState().setLastActiveByMode("entertainment", id);
      }
    },

    setWizardStep: (step) =>
      set({
        wizardStep:
          typeof step === "function" ? step(get().wizardStep) : step,
      }),

    startNewWizard: async () => {
      // Reset the reader cache first so the wizard evaluates against a clean
      // slate (showWizard requires no current chapter).
      useChaptersStore.getState().reset();
      // Backend generates the id (single source of truth; no client crypto).
      const { id } = await httpClient.postJSON<{ id: string }>("/threads", {
        mode: "entertainment",
      });
      set({ activeThreadId: id, wizardStep: 0 });
      useUiStore.getState().setLastActiveByMode("entertainment", id);
      // Surface the new row in the sidebar immediately.
      await get().refresh();
    },

    load: async () => {
      set({ loading: true });
      let threads: ThreadInfo[];
      try {
        threads = await fetchEntertainmentThreads();
      } finally {
        set({ loading: false });
      }

      const ids = new Set(threads.map((t) => t.id));
      const current = get().activeThreadId;
      const lastActive = useUiStore.getState().lastActiveByMode.entertainment;

      if (current && ids.has(current)) {
        return; // still valid — keep
      }
      if (lastActive && ids.has(lastActive)) {
        set({ activeThreadId: lastActive });
        return;
      }
      if (threads.length > 0) {
        // listThreadsByMode returns most-recent first.
        set({ activeThreadId: threads[0]!.id });
        return;
      }
      // First-ever use: no entertainment threads yet — start a fresh wizard.
      await get().startNewWizard();
    },

    refresh: async () => {
      const threads = await fetchEntertainmentThreads();
      const current = get().activeThreadId;
      if (!current) return;
      if (threads.some((t) => t.id === current)) return; // still present

      // Active thread was deleted (e.g. the wizard's "Start over"). Recover to
      // the last-active if it still exists, else the most-recent, else a fresh
      // wizard.
      const lastActive = useUiStore.getState().lastActiveByMode.entertainment;
      if (lastActive && threads.some((t) => t.id === lastActive)) {
        set({ activeThreadId: lastActive });
      } else if (threads.length > 0) {
        set({ activeThreadId: threads[0]!.id });
      } else {
        await get().startNewWizard();
      }
    },
  })),
);
