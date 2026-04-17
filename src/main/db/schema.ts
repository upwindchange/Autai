import { pgTable, text, integer, serial, varchar, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const settings = pgTable("settings", {
  key: varchar().primaryKey(),
  value: text().notNull(),
});

export const userProviders = pgTable("user_providers", {
  id: varchar().primaryKey(),
  providerDir: varchar("provider_dir").notNull(),
  apiKey: text("api_key").notNull().default(""),
  apiUrlOverride: text("api_url_override"),
});

export const modelAssignments = pgTable("model_assignments", {
  role: varchar().primaryKey(),
  providerId: varchar("provider_id")
    .notNull()
    .references(() => userProviders.id, { onDelete: "cascade" }),
  modelFile: varchar("model_file").notNull(),
  params: text(),
});

export const threads = pgTable("threads", {
  id: varchar().primaryKey(),
  title: text().notNull().default("New Chat"),
  status: text().notNull().default("regular"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  chatProviderId: varchar("chat_provider_id").references(() => userProviders.id, {
    onDelete: "set null",
  }),
  chatModelFile: varchar("chat_model_file"),
  chatModelParams: text("chat_model_params"),
});

export const messages = pgTable("messages", {
  id: varchar().primaryKey(),
  threadId: varchar("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  role: text().notNull(),
  content: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tags = pgTable("tags", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const threadTags = pgTable(
  "thread_tags",
  {
    threadId: varchar("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.tagId] }),
  ],
);
