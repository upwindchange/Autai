import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { ThreadMode } from "@shared/tag";

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
  // Top-level UI mode. Orthogonal to `status` (which assistant-ui owns as
  // regular|archived). `mode` lives entirely outside the runtime as app-local
  // metadata and partitions threads between the chat UI and the entertainment UI.
  mode: text("mode").notNull().default("chat"),
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
  emoji: text(),
  color: text(),
  sortOrder: integer("sort_order").notNull().default(0),
  // Top-level UI mode this tag belongs to, mirroring `threads.mode`. Keeps chat
  // tags (coding/research/…) and entertainment tags (重写/互动) in separate sets
  // so each sidebar only ever shows its own tags.
  mode: text("mode").notNull().default("chat").$type<ThreadMode>(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const mcpServers = sqliteTable("mcp_servers", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text(),
  transportType: text("transport_type").notNull(), // 'http' | 'sse'
  connectionConfig: text("connection_config").notNull(), // JSON string
  enabled: text().notNull().default("true"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
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
  (table) => [primaryKey({ columns: [table.threadId, table.tagId] })],
);

// Remote-access sessions. One row per logged-in client (each browser/device gets
// its own). tokenHash = sha256(token) so a DB read does not expose live tokens.
// Timestamps are JS ISO strings, kept consistent for lexicographic comparisons.
export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});
