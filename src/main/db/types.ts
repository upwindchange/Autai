import { InferSelectModel } from "drizzle-orm";
import {
  threads,
  messages,
  tags,
  userProviders,
  modelAssignments,
  settings,
  mcpServers,
  entertainmentConfigs,
  chapters,
  bookmarks,
  chapterMeta,
} from "./schema";

export type ThreadRow = InferSelectModel<typeof threads>;
export type MessageRow = InferSelectModel<typeof messages>;
export type TagRow = InferSelectModel<typeof tags>;
export type UserProviderRow = InferSelectModel<typeof userProviders>;
export type ModelAssignmentRow = InferSelectModel<typeof modelAssignments>;
export type SettingRow = InferSelectModel<typeof settings>;
export type McpServerRow = InferSelectModel<typeof mcpServers>;
export type EntertainmentConfigRow = InferSelectModel<
  typeof entertainmentConfigs
>;
export type ChapterRow = InferSelectModel<typeof chapters>;
export type BookmarkRow = InferSelectModel<typeof bookmarks>;
export type ChapterMetaRow = InferSelectModel<typeof chapterMeta>;

export interface ThreadWithTags extends ThreadRow {
  tags: TagRow[];
}
