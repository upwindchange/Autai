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

export interface ThreadWithTags {
  remoteId: string;
  title: string;
  status: "regular" | "archived";
  tags: TagRow[];
}
