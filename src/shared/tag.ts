/**
 * Tag-related types for conversation categorization.
 */

export interface TagRow {
  id: number;
  name: string;
  emoji: string | null;
  color: string;
  sortOrder: number;
  createdAt: string;
}

/**
 * Top-level UI mode for a thread. Orthogonal to `status` (regular|archived),
 * which is assistant-ui's domain. `mode` partitions threads between the chat
 * UI ("chat") and the entertainment UI ("entertainment"); it never reaches the
 * assistant-ui runtime.
 */
export type ThreadMode = "chat" | "entertainment";

export interface ThreadWithTags {
  remoteId: string;
  title: string;
  status: "regular" | "archived";
  mode: ThreadMode;
  tags: TagRow[];
}
