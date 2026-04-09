/**
 * Tag-related types for conversation categorization.
 */

export interface TagRow {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface ThreadWithTags {
  remoteId: string;
  title: string | null;
  status: "regular" | "archived";
  tags: TagRow[];
}
