import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { ThreadMode } from "@shared/tag";
import type {
  EntertainmentMode,
  SourceChapterStatus,
  RewrittenChapterStatus,
  ChapterMetaKind,
} from "@shared/entertainment";

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

// ---------------------------------------------------------------------------
// Entertainment mode
//
// Entertainment threads (threads.mode = 'entertainment') hold a novel-reading
// session. Unlike chat, entertainment is fully decoupled from the `messages`
// table: chapter prose lives across `source_chapters` (原文) and
// `rewritten_chapters` (重写), not in assistant messages. Chapters are
// first-class entities keyed by their own UUID, never by a message id. All
// entertainment tables hang off `threads.id`.
// ---------------------------------------------------------------------------

// Wizard settings + novel origin, 1:1 with a thread. `mode` + `options` are the
// fixed session settings; `novelSource` is the *origin pointer/instruction*
// (file path / URL / search guidance) from the wizard — NOT the novel content.
// It is nullable and updatable because the input is dynamic, especially for
// internet novels fetched chapter-by-chapter over multiple sessions. The actual
// novel content accrues as `source_chapters` / `rewritten_chapters` rows.
export const entertainmentConfigs = sqliteTable("entertainment_configs", {
  threadId: text("thread_id")
    .primaryKey()
    .references(() => threads.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().$type<EntertainmentMode>(),
  options: text("options").notNull(), // JSON: mode-dependent settings (basic/depth/frequency)
  novelSource: text("novel_source"), // nullable, updatable JSON: origin pointer/instruction (see above)
  // Last-read chapter for interrupt recovery (point 9); reopen resumes here.
  lastChapterNumber: integer("last_chapter_number"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// --- Dehydration pipeline tables --------------------------------------------
// Two tables, each keyed by (threadId, chapterNumber):
//   - sourceChapters    原文 — acquired text (file ingestion OR network fetch)
//   - rewrittenChapters 重写 — the rewritten prose the reader actually shows
// The reader only ever reads rewrittenChapters; sourceChapters feeds the
// rewrite agent. Both accrue as the lookahead window (current chapter + 10)
// advances. `id` is independent (crypto.randomUUID()), never a message id.

export const sourceChapters = sqliteTable(
  "source_chapters",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    title: text("title"),
    content: text("content"), // 原文 (raw source text); null while status='fetching'
    status: text("status")
      .notNull()
      .default("fetching")
      .$type<SourceChapterStatus>(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("source_chapters_thread_number_unique").on(
      t.threadId,
      t.chapterNumber,
    ),
    index("source_chapters_thread_id_idx").on(t.threadId),
  ],
);

export const rewrittenChapters = sqliteTable(
  "rewritten_chapters",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    chapterNumber: integer("chapter_number").notNull(),
    content: text("content"), // 重写 (rewritten prose); null while status='rewriting'
    status: text("status")
      .notNull()
      .default("rewriting")
      .$type<RewrittenChapterStatus>(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("rewritten_chapters_thread_number_unique").on(
      t.threadId,
      t.chapterNumber,
    ),
    index("rewritten_chapters_thread_id_idx").on(t.threadId),
  ],
);

// Saved reading positions within a chapter. `anchor` is a nullable JSON
// coordinate whose shape the reader decides ({percentile} | {paraIndex,
// charOffset} | {textSnippet}). threadId is denormalized (derivable via
// chapters) for direct thread-level listing and cascade safety.
export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => rewrittenChapters.id, { onDelete: "cascade" }),
    anchor: text("anchor"),
    label: text("label"),
    note: text("note"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index("bookmarks_thread_id_idx").on(t.threadId),
    index("bookmarks_chapter_id_idx").on(t.chapterId),
  ],
);

// The open, extensible per-chapter metadata spine. One row per (chapter, kind,
// instance). `kind` discriminates the metadata type and `payload` is a JSON blob
// whose shape varies by kind (validated per-kind via Zod in app code). Seeded
// kinds cover Requirement 5: per-chapter setting, user interaction, agent
// comments, tool calls, and agent-offered story interaction options. Adding a
// new kind for a future entertainment mode needs NO migration — just a new kind
// string + a Zod payload schema. `sortOrder` orders multiple same-kind rows
// (e.g. several agent comments or offered options). threadId is denormalized for
// thread-level queries ("all agent comments in this thread").
export const chapterMeta = sqliteTable(
  "chapter_meta",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => rewrittenChapters.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<ChapterMetaKind>(),
    payload: text("payload").notNull(), // JSON: shape varies by `kind`
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index("chapter_meta_chapter_kind_idx").on(t.chapterId, t.kind),
    index("chapter_meta_thread_kind_idx").on(t.threadId, t.kind),
  ],
);
