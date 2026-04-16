import { InferSelectModel } from "drizzle-orm";
import {
  threads,
  messages,
  tags,
  userProviders,
  modelAssignments,
  settings,
} from "./schema";

export type ThreadRow = InferSelectModel<typeof threads>;
export type MessageRow = InferSelectModel<typeof messages>;
export type TagRow = InferSelectModel<typeof tags>;
export type UserProviderRow = InferSelectModel<typeof userProviders>;
export type ModelAssignmentRow = InferSelectModel<typeof modelAssignments>;
export type SettingRow = InferSelectModel<typeof settings>;

export interface ThreadWithTags extends ThreadRow {
  tags: TagRow[];
}
