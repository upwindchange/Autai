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

  // Actions
  fetchTags: () => Promise<void>;
  createTag: (name: string) => Promise<TagRow>;
  deleteTag: (id: number) => Promise<void>;
  renameTag: (id: number, name: string) => Promise<void>;
  setSelectedTagId: (id: number | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setThreadTags: (threadTags: Record<string, TagRow[]>, threads: ThreadInfo[]) => void;
  getTagsForThread: (remoteId: string | undefined) => TagRow[];
}

export const useTagStore = create<TagState>()(
  subscribeWithSelector((set, get) => ({
    tags: [],
    loading: false,
    threadTags: {},
    threads: [],
    selectedTagId: null,
    viewMode: "flat",

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
    setViewMode: (mode) => set({ viewMode: mode }),

    setThreadTags: (threadTags, threads) => set({ threadTags, threads }),

    getTagsForThread: (remoteId) => {
      if (!remoteId) return [];
      return get().threadTags[remoteId] ?? [];
    },
  })),
);
