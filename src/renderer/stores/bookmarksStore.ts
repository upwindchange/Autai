import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { Bookmark } from "@shared";
import { httpClient } from "@/lib/httpClient";

/**
 * Reader bookmarks store — the bookmark panel's source of truth.
 *
 * Like `chaptersStore`, this is a thin cache over the entertainment REST API:
 * load on thread switch, await-then-prepend on create (the POST returns the
 * exact row to render, so there's no flash and no missing createdAt), and
 * optimistically remove on delete (deletion is idempotent and feels instant).
 * There is no polling — bookmarks only change via this client.
 */
interface BookmarksState {
  currentThreadId: string | null;
  bookmarks: Bookmark[]; // newest first (server returns desc; client preserves)
  loading: boolean;

  /** Re-read all bookmarks for the thread (full replace). */
  loadBookmarks: (threadId: string) => Promise<void>;
  /** Save the current reading spot; prepends the returned bookmark. */
  addBookmark: (
    threadId: string,
    input: { chapterNumber: number; scrollRatio: number | null },
  ) => Promise<void>;
  /** Remove a bookmark (optimistic). */
  removeBookmark: (threadId: string, id: string) => Promise<void>;
}

const byCreatedAtDesc = (a: Bookmark, b: Bookmark) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

export const useBookmarksStore = create<BookmarksState>()(
  subscribeWithSelector((set) => ({
    currentThreadId: null,
    bookmarks: [],
    loading: false,

    loadBookmarks: async (threadId) => {
      set({ loading: true });
      try {
        const { bookmarks } = await httpClient.getJSON<{ bookmarks: Bookmark[] }>(
          `/entertainment/threads/${threadId}/bookmarks`,
        );
        set({
          currentThreadId: threadId,
          bookmarks: [...bookmarks].sort(byCreatedAtDesc),
          loading: false,
        });
      } catch {
        set({ loading: false });
      }
    },

    addBookmark: async (threadId, { chapterNumber, scrollRatio }) => {
      const { bookmark } = await httpClient.postJSON<{ bookmark: Bookmark }>(
        `/entertainment/threads/${threadId}/bookmarks`,
        {
          chapterNumber,
          // null/0 → top of a short chapter is still a valid, restorable spot.
          anchor: { scrollRatio: scrollRatio ?? 0 },
        },
      );
      set((state) => ({
        currentThreadId: threadId,
        bookmarks: [bookmark, ...state.bookmarks].sort(byCreatedAtDesc),
      }));
    },

    removeBookmark: async (threadId, id) => {
      // Optimistic: drop locally first, then fire the delete.
      set((state) => ({
        bookmarks: state.bookmarks.filter((b) => b.id !== id),
      }));
      await httpClient.delete(`/entertainment/threads/${threadId}/bookmarks/${id}`);
    },
  })),
);
