import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { TagRow, ThreadMode } from "@shared/tag";
import { useUiStore } from "@/stores/uiStore";
import {
  fetchTags,
  createTag as apiCreateTag,
  deleteTag as apiDeleteTag,
  updateTag as apiUpdateTag,
  addTagToThread as apiAddTagToThread,
  removeTagFromThread as apiRemoveTagFromThread,
  searchThreads as apiSearchThreads,
  renameThread as apiRenameThread,
} from "@/lib/tagApi";

export type ViewMode = "flat" | "grouped";

export interface ThreadInfo {
  remoteId: string;
  title: string;
  tags: TagRow[];
  status: "regular" | "archived";
  mode: ThreadMode;
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

  // Search state
  searchQuery: string;
  searchResultIds: Set<string> | null; // null = no search active
  isSearching: boolean;

  // Actions
  fetchTags: () => Promise<void>;
  createTag: (name: string, color: string) => Promise<TagRow>;
  deleteTag: (id: number) => Promise<void>;
  updateTag: (id: number, updates: { name?: string; color?: string }) => Promise<void>;
  setSelectedTagId: (id: number | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setViewingArchive: (viewing: boolean) => void;
  setThreadTags: (
    threadTags: Record<string, TagRow[]>,
    threads: ThreadInfo[],
  ) => void;
  addTagToThread: (threadRemoteId: string, tagId: number) => Promise<void>;
  removeTagFromThread: (threadRemoteId: string, tagId: number) => Promise<void>;
  renameThread: (threadRemoteId: string, title: string) => Promise<void>;
  updateThreadTitle: (
    threadRemoteId: string,
    title: string,
    tags?: TagRow[],
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

  // Search actions
  setSearchQuery: (query: string) => void;
  performSearch: (query: string) => Promise<void>;
  clearSearch: () => void;
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
    searchQuery: "",
    searchResultIds: null,
    isSearching: false,

    fetchTags: async () => {
      set({ loading: true });
      try {
        const tags = await fetchTags();
        const tagMap = new Map(tags.map((t) => [t.id, t]));
        set((state) => ({
          tags,
          loading: false,
          threadTags: Object.fromEntries(
            Object.entries(state.threadTags).map(([key, threadTagList]) => [
              key,
              threadTagList.map((t) => tagMap.get(t.id) ?? t),
            ]),
          ),
          threads: state.threads.map((th) => ({
            ...th,
            tags: th.tags.map((t) => tagMap.get(t.id) ?? t),
          })),
        }));
      } catch {
        set({ loading: false });
      }
    },

    createTag: async (name: string, color: string) => {
      const tag = await apiCreateTag(name, color);
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

    updateTag: async (
      id: number,
      updates: { name?: string; color?: string },
    ) => {
      const updatedTag = await apiUpdateTag(id, updates);
      set((state) => ({
        tags: state.tags.map((t) => (t.id === id ? updatedTag : t)),
        threadTags: Object.fromEntries(
          Object.entries(state.threadTags).map(([key, tags]) => [
            key,
            tags.map((t) => (t.id === id ? updatedTag : t)),
          ]),
        ),
        threads: state.threads.map((th) => ({
          ...th,
          tags: th.tags.map((t) => (t.id === id ? updatedTag : t)),
        })),
      }));
    },

    setSelectedTagId: (id) =>
      set({ selectedTagId: id, searchQuery: "", searchResultIds: null }),

    setViewMode: (mode) =>
      set({
        viewMode: mode,
        isMultiSelectMode: false,
        selectedThreadIds: new Set<string>(),
      }),

    setViewingArchive: (viewing) =>
      set({
        viewingArchive: viewing,
        isMultiSelectMode: false,
        selectedThreadIds: new Set<string>(),
        searchQuery: "",
        searchResultIds: null,
      }),

    setThreadTags: (threadTags, threads) => set({ threadTags, threads }),

    addTagToThread: async (threadRemoteId, tagId) => {
      await apiAddTagToThread(threadRemoteId, tagId);
      const state = get();
      const tag = state.tags.find((t) => t.id === tagId);
      if (!tag) return;
      const newTags = [...(state.threadTags[threadRemoteId] ?? []), tag];
      set({
        threadTags: { ...state.threadTags, [threadRemoteId]: newTags },
        threads: state.threads.map((th) =>
          th.remoteId === threadRemoteId ? { ...th, tags: newTags } : th,
        ),
      });
    },

    removeTagFromThread: async (threadRemoteId, tagId) => {
      await apiRemoveTagFromThread(threadRemoteId, tagId);
      const state = get();
      const newTags = (state.threadTags[threadRemoteId] ?? []).filter(
        (t) => t.id !== tagId,
      );
      set({
        threadTags: { ...state.threadTags, [threadRemoteId]: newTags },
        threads: state.threads.map((th) =>
          th.remoteId === threadRemoteId ? { ...th, tags: newTags } : th,
        ),
      });
    },

    renameThread: async (threadRemoteId, title) => {
      await apiRenameThread(threadRemoteId, title);
      set({
        threads: get().threads.map((th) =>
          th.remoteId === threadRemoteId ? { ...th, title } : th,
        ),
      });
    },

    updateThreadTitle: (threadRemoteId, title, tags) => {
      const threads = get().threads;
      const exists = threads.some((th) => th.remoteId === threadRemoteId);
      if (exists) {
        set({
          threads: threads.map((th) => {
            if (th.remoteId !== threadRemoteId) return th;
            return { ...th, title, ...(tags !== undefined ? { tags } : {}) };
          }),
          ...(tags !== undefined ?
            {
              threadTags: {
                ...get().threadTags,
                [threadRemoteId]: tags,
              },
            }
          : {}),
        });
      } else {
        set({
          threads: [
            ...threads,
            {
              remoteId: threadRemoteId,
              title,
              tags: tags ?? [],
              status: "regular" as const,
              // Fallback synthetic insert for a metadata update on a thread not
              // currently in the (mode-filtered) list. Default to the active mode.
              mode: useUiStore.getState().appMode,
            },
          ],
          ...(tags !== undefined ?
            {
              threadTags: {
                ...get().threadTags,
                [threadRemoteId]: tags,
              },
            }
          : {}),
        });
      }
    },

    getTagsForThread: (remoteId) => {
      if (!remoteId) return [];
      return get().threadTags[remoteId] ?? [];
    },

    // Multi-select actions
    setMultiSelectMode: (enabled) =>
      set({
        isMultiSelectMode: enabled,
        selectedThreadIds:
          enabled ? get().selectedThreadIds : new Set<string>(),
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
      const next = new Set(allThreadIds.filter((id) => !current.has(id)));
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

    setSearchQuery: (query) => set({ searchQuery: query }),

    performSearch: async (query) => {
      const trimmed = query.trim();
      if (!trimmed) {
        set({ searchResultIds: null, isSearching: false });
        return;
      }
      set({ isSearching: true });
      try {
        const result = await apiSearchThreads(trimmed, useUiStore.getState().appMode);
        const ids = new Set(result.threads.map((t) => t.remoteId));
        set({ searchResultIds: ids, isSearching: false });
      } catch {
        set({ isSearching: false });
      }
    },

    clearSearch: () =>
      set({ searchQuery: "", searchResultIds: null, isSearching: false }),
  })),
);
