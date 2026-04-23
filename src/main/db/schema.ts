import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const settings = sqliteTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});

export const userProviders = sqliteTable("user_providers", {
  id: text().primaryKey(),
  providerDir: text("provider_dir").notNull(),
  apiKey: text("api_key").notNull().default(""),
  apiUrlOverride: text("api_url_override"),
  npm: text().notNull(),
  defaultApiUrl: text("default_api_url"),
});

export const modelAssignments = sqliteTable("model_assignments", {
  role: text().primaryKey(),
  providerId: text("provider_id")
    .notNull()
    .references(() => userProviders.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  params: text(),
});

export const threads = sqliteTable("threads", {
  id: text().primaryKey(),
  title: text().notNull().default("New Chat"),
  status: text().notNull().default("regular"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  chatProviderId: text("chat_provider_id").references(() => userProviders.id, {
    onDelete: "set null",
  }),
  chatModelId: text("chat_model_id"),
  chatModelParams: text("chat_model_params"),
  chatSystemPrompt: text("chat_system_prompt"),
});

export const messages = sqliteTable("messages", {
  id: text().primaryKey(),
  threadId: text("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  role: text().notNull(),
  content: text().notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const tags = sqliteTable("tags", {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const threadTags = sqliteTable(
  "thread_tags",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.tagId] }),
  }),
);
