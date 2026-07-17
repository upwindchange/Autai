import { create } from "zustand";
import log from "electron-log/renderer";
import { getApiBase } from "@/lib/api";
import type { ModelParameters } from "@shared";

const logger = log.scope("ThreadModelStore");

/**
 * Per-thread chat model selection held IN RAM — the live source of truth for
 * the header picker and the per-request X-Chat-* headers. The DB is only a
 * persistence cache (written on change / first-save, read once on load).
 *
 * `map[threadId]`:
 *   undefined            → not loaded yet (treated as "use default")
 *   { providerId: null } → loaded, explicitly using the global default
 *   { providerId, ... }  → loaded override
 *
 * `params` / `systemPrompt` follow the same nullability convention:
 *   undefined → not loaded yet
 *   null      → loaded, explicitly cleared (fall back to system default)
 *   <value>   → loaded override
 */
export interface ThreadModelSelection {
  providerId: string | null;
  modelId: string | null;
  params: ModelParameters | null;
  systemPrompt: string | null;
}

interface ThreadModelState {
  map: Record<string, ThreadModelSelection | undefined>;
  get: (
    threadId: string | null | undefined,
  ) => ThreadModelSelection | undefined;
  set: (threadId: string, selection: ThreadModelSelection) => void;
  clear: (threadId: string) => void;
  /** Load the saved override from the DB once per thread (validated server-side). */
  loadFromDb: (threadId: string) => Promise<void>;
}

export const useThreadModelStore = create<ThreadModelState>((set, get) => ({
  map: {},

  get: (threadId) => (threadId ? get().map[threadId] : undefined),

  set: (threadId, selection) =>
    set((s) => ({ map: { ...s.map, [threadId]: selection } })),

  clear: (threadId) =>
    set((s) => {
      const next = { ...s.map };
      delete next[threadId];
      return { map: next };
    }),

  loadFromDb: async (threadId) => {
    if (get().map[threadId] !== undefined) return; // already loaded (or loading)
    // Synchronous sentinel dedupes concurrent calls; overwritten on resolve.
    set((s) => ({
      map: {
        ...s.map,
        [threadId]: {
          providerId: null,
          modelId: null,
          params: null,
          systemPrompt: null,
        },
      },
    }));
    try {
      const res = await fetch(`${getApiBase()}/threads/${threadId}/model`);
      const data = (await res.json()) as Partial<ThreadModelSelection>;
      // Merge against the sentinel so a partial/older response can't drop keys.
      set((s) => ({
        map: {
          ...s.map,
          [threadId]: {
            providerId: data.providerId ?? null,
            modelId: data.modelId ?? null,
            params: data.params ?? null,
            systemPrompt: data.systemPrompt ?? null,
          },
        },
      }));
      logger.debug("loadFromDb", {
        threadId,
        providerId: data.providerId ?? null,
        modelId: data.modelId ?? null,
        hasParams: !!data.params,
        hasSystemPrompt: !!data.systemPrompt,
      });
    } catch (err) {
      // leave the sentinel in place ⇒ use default
      logger.warn("loadFromDb failed, using defaults", { threadId, err });
    }
  },
}));
