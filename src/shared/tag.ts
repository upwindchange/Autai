/**
 * Tag-related types for conversation categorization.
 */

export interface TagRow {
  id: number;
  name: string;
  emoji: string | null;
  color: string;
  sortOrder: number;
  mode: ThreadMode;
  createdAt: string;
}

/**
 * Top-level UI mode for a thread. Orthogonal to `status` (regular|archived).
 * `mode` partitions threads between the chat UI ("chat") and the story
 * UI ("story").
 */
export type ThreadMode = "chat" | "story";
