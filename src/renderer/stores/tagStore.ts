import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { TagRow } from "@shared/tag";
import {
  fetchTags,
  createTag as apiCreateTag,
  deleteTag as apiDeleteTag,
  renameTag as apiRenameTag,
} from "@/lib/tagApi";

export type ViewMode = "flat" | "grouped";

export interface ThreadInfo {
  remoteId: string;
  title: string | undefined;
  tags: TagRow[];
  status: "regular" | "archived";
}

interface TagState {
  // Tag data
  tags: TagRow[];
  loading: boolean;

  // Thread-to-tags mapping (keyed by thread remoteId)
  threadTags: Record<string, TagRow[]>;

  // Full thread list data (populated from adapter list())
  threads: ThreadInfo[];

  // View state
  selectedTagId: number | null; // null = show all
  viewMode: ViewMode;
  viewingArchive: boolean;

  // Multi-select state
  isMultiSelectMode: boolean;
  selectedThreadIds: Set<string>;

  // Actions
  fetchTags: () => Promise<void>;
  createTag: (name: string) => Promise<TagRow>;
  deleteTag: (id: number) => Promise<void>;
  renameTag: (id: number, name: string) => Promise<void>;
  setSelectedTagId: (id: number | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setViewingArchive: (viewing: boolean) => void;
  setThreadTags: (
    threadTags: Record<string, TagRow[]>,
    threads: ThreadInfo[],
  ) => void;
  getTagsForThread: (remoteId: string | undefined) => TagRow[];

  // Multi-select actions
  setMultiSelectMode: (enabled: boolean) => void;
  toggleThreadSelection: (threadId: string) => void;
  selectAllThreads: (threadIds: string[]) => void;
  clearSelection: () => void;
  invertSelection: (allThreadIds: string[]) => void;
  selectThreadsDownward: (allThreadIds: string[], fromIndex: number) => void;
  exitMultiSelectMode: () => void;
}

export const useTagStore = create<TagState>()(
  subscribeWithSelector((set, get) => ({
    tags: [],
    loading: false,
    threadTags: {},
    threads: [],
    selectedTagId: null,
    viewMode: "flat",
    viewingArchive: false,
    isMultiSelectMode: false,
    selectedThreadIds: new Set<string>(),

    fetchTags: async () => {
      set({ loading: true });
      try {
        const tags = await fetchTags();
        set({ tags, loading: false });
      } catch {
        set({ loading: false });
      }
    },

    createTag: async (name: string) => {
      const tag = await apiCreateTag(name);
      set((state) => ({ tags: [...state.tags, tag] }));
      return tag;
    },

    deleteTag: async (id: number) => {
      await apiDeleteTag(id);
      set((state) => ({
        tags: state.tags.filter((t) => t.id !== id),
        selectedTagId: state.selectedTagId === id ? null : state.selectedTagId,
      }));
    },

    renameTag: async (id: number, name: string) => {
      await apiRenameTag(id, name);
      set((state) => ({
        tags: state.tags.map((t) => (t.id === id ? { ...t, name } : t)),
      }));
    },

    setSelectedTagId: (id) => set({ selectedTagId: id }),

    setViewMode: (mode) =>
      set({ viewMode: mode, isMultiSelectMode: false, selectedThreadIds: new Set<string>() }),

    setViewingArchive: (viewing) =>
      set({ viewingArchive: viewing, isMultiSelectMode: false, selectedThreadIds: new Set<string>() }),

    setThreadTags: (threadTags, threads) => set({ threadTags, threads }),

    getTagsForThread: (remoteId) => {
      if (!remoteId) return [];
      return get().threadTags[remoteId] ?? [];
    },

    // Multi-select actions
    setMultiSelectMode: (enabled) =>
      set({
        isMultiSelectMode: enabled,
        selectedThreadIds: enabled ? get().selectedThreadIds : new Set<string>(),
      }),

    toggleThreadSelection: (threadId) => {
      const current = get().selectedThreadIds;
      const next = new Set(current);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      set({ selectedThreadIds: next });
    },

    selectAllThreads: (threadIds) =>
      set({ selectedThreadIds: new Set(threadIds) }),

    clearSelection: () => set({ selectedThreadIds: new Set<string>() }),

    invertSelection: (allThreadIds) => {
      const current = get().selectedThreadIds;
      const next = new Set(
        allThreadIds.filter((id) => !current.has(id)),
      );
      set({ selectedThreadIds: next });
    },

    selectThreadsDownward: (allThreadIds, fromIndex) => {
      const current = get().selectedThreadIds;
      const toSelect = allThreadIds.slice(fromIndex);
      const next = new Set([...current, ...toSelect]);
      set({ selectedThreadIds: next });
    },

    exitMultiSelectMode: () =>
      set({ isMultiSelectMode: false, selectedThreadIds: new Set<string>() }),
  })),
);
