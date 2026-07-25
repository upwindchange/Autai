import { getDb, getSqlite } from "@/db";
import { threads, messages, tags, threadTags } from "@/db/schema";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import type { UIMessage } from "ai";
import log from "electron-log/main";
import type { ThreadRow, TagRow, ThreadWithTags } from "@/db/types";
import type { ThreadMode } from "@shared/tag";
import type { ModelParameters } from "@shared";

const logger = log.scope("ThreadPersistenceService");

class ThreadPersistenceService {
  initialize(): void {
    // DB is already initialized by initializeDatabase() in @/db
    logger.info("ThreadPersistenceService ready");
  }

  createThread(id: string, mode: ThreadMode = "chat"): ThreadRow {
    const db = getDb();
    db.insert(threads).values({ id, mode }).run();
    return this.getThread(id)!;
  }

  listThreads(): ThreadWithTags[] {
    const db = getDb();
    const rows = db
      .select()
      .from(threads)
      .where(eq(threads.status, "regular"))
      .orderBy(desc(threads.updatedAt))
      .all();

    return rows.map((thread) => ({
      ...thread,
      tags: this.getTagsForThread(thread.id),
    }));
  }

  listAllThreads(): ThreadWithTags[] {
    const db = getDb();
    const rows = db
      .select()
      .from(threads)
      .orderBy(desc(threads.updatedAt))
      .all();

    return rows.map((thread) => ({
      ...thread,
      tags: this.getTagsForThread(thread.id),
    }));
  }

  // Threads scoped to a top-level UI mode. Returns both `regular` and
  // `archived` of that mode so the sidebar's archive toggle still works; the
  // client filters by status on top. Used by GET /threads?mode=.
  listThreadsByMode(mode: ThreadMode): ThreadWithTags[] {
    const db = getDb();
    const rows = db
      .select()
      .from(threads)
      .where(eq(threads.mode, mode))
      .orderBy(desc(threads.updatedAt))
      .all();

    return rows.map((thread) => ({
      ...thread,
      tags: this.getTagsForThread(thread.id),
    }));
  }

  deleteAllThreads(status: "regular" | "archived", mode: ThreadMode): void {
    const db = getDb();
    db.delete(threads)
      .where(and(eq(threads.status, status), eq(threads.mode, mode)))
      .run();
  }

  archiveAllThreads(mode: ThreadMode): void {
    const db = getDb();
    db.update(threads)
      .set({ status: "archived", updatedAt: sql`(datetime('now'))` })
      .where(and(eq(threads.status, "regular"), eq(threads.mode, mode)))
      .run();
  }

  getThread(id: string): ThreadRow | undefined {
    const db = getDb();
    return db.select().from(threads).where(eq(threads.id, id)).get();
  }

  renameThread(id: string, title: string): void {
    const db = getDb();
    db.update(threads)
      .set({ title, updatedAt: sql`(datetime('now'))` })
      .where(eq(threads.id, id))
      .run();
  }

  setThreadChatOverride(
    id: string,
    override: {
      providerId: string | null;
      modelId: string | null;
      params?: ModelParameters | null;
      systemPrompt?: string | null;
    },
  ): void {
    logger.debug("setThreadChatOverride", {
      id,
      providerId: override.providerId,
      modelId: override.modelId,
      hasParams: override.params !== undefined,
      hasSystemPrompt: override.systemPrompt !== undefined,
    });
    const db = getDb();
    db.update(threads)
      .set({
        chatProviderId: override.providerId,
        chatModelId: override.modelId,
        // Persist per-thread params (JSON) + system prompt (plain text). null
        // means "explicitly cleared → use the global default".
        ...(override.params !== undefined && {
          chatModelParams:
            override.params ? JSON.stringify(override.params) : null,
        }),
        ...(override.systemPrompt !== undefined && {
          chatSystemPrompt: override.systemPrompt,
        }),
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(threads.id, id))
      .run();
  }

  archiveThread(id: string): void {
    const db = getDb();
    db.update(threads)
      .set({ status: "archived", updatedAt: sql`(datetime('now'))` })
      .where(eq(threads.id, id))
      .run();
  }

  unarchiveThread(id: string): void {
    const db = getDb();
    db.update(threads)
      .set({ status: "regular", updatedAt: sql`(datetime('now'))` })
      .where(eq(threads.id, id))
      .run();
  }

  deleteThread(id: string): void {
    const db = getDb();
    db.delete(threads).where(eq(threads.id, id)).run();
  }

  saveMessages(
    threadId: string,
    msgs: UIMessage[],
    selection?: {
      providerId: string;
      modelId: string;
      params?: ModelParameters | null;
      systemPrompt?: string | null;
    },
  ): void {
    const db = getDb();
    db.transaction((tx) => {
      tx.update(threads)
        .set({
          updatedAt: sql`(datetime('now'))`,
          // Persist the per-thread chat model + params + system prompt on every
          // save (covers a new conversation's first save + reaffirms existing
          // threads). Only written when the request carried an explicit
          // selection — the raw thread-level override, never a resolved
          // system-default fallback.
          ...(selection && {
            // Only overwrite provider/model when the request carried a real
            // selection — an empty string would wipe an existing override.
            ...(selection.providerId && {
              chatProviderId: selection.providerId,
            }),
            ...(selection.modelId && { chatModelId: selection.modelId }),
            ...(selection.params !== undefined && {
              chatModelParams:
                selection.params ? JSON.stringify(selection.params) : null,
            }),
            ...(selection.systemPrompt !== undefined && {
              chatSystemPrompt: selection.systemPrompt,
            }),
          }),
        })
        .where(eq(threads.id, threadId))
        .run();

      tx.delete(messages).where(eq(messages.threadId, threadId)).run();
      for (const msg of msgs) {
        tx.insert(messages)
          .values({
            id: msg.id,
            threadId,
            role: msg.role,
            content: JSON.stringify(msg),
          })
          .run();
      }
    });
  }

  loadMessages(threadId: string): UIMessage[] {
    const db = getDb();
    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt))
      .all();

    return rows.map((row) => JSON.parse(row.content) as UIMessage);
  }

  // ---------------------------------------------------------------------------
  // Tag operations
  // ---------------------------------------------------------------------------

  createTag(
    name: string,
    color: string,
    sortOrder?: number,
    mode: ThreadMode = "chat",
  ): TagRow {
    const db = getDb();
    const result = db
      .insert(tags)
      .values({ name, color, sortOrder: sortOrder ?? 0, mode })
      .returning()
      .get();
    return result;
  }

  listTags(): TagRow[] {
    const db = getDb();
    return db
      .select()
      .from(tags)
      .orderBy(asc(tags.sortOrder), asc(tags.name))
      .all();
  }

  listTagsByMode(mode: ThreadMode): TagRow[] {
    const db = getDb();
    return db
      .select()
      .from(tags)
      .where(eq(tags.mode, mode))
      .orderBy(asc(tags.sortOrder), asc(tags.name))
      .all();
  }

  getTag(id: number): TagRow | undefined {
    const db = getDb();
    return db.select().from(tags).where(eq(tags.id, id)).get();
  }

  updateTag(id: number, updates: { name?: string; color?: string }): void {
    const db = getDb();
    db.update(tags).set(updates).where(eq(tags.id, id)).run();
  }

  deleteTag(id: number): void {
    const db = getDb();
    db.delete(tags).where(eq(tags.id, id)).run();
  }

  addTagToThread(threadId: string, tagId: number): void {
    const db = getDb();
    db.insert(threadTags)
      .values({ threadId, tagId })
      .onConflictDoNothing()
      .run();
  }

  removeTagFromThread(threadId: string, tagId: number): void {
    const db = getDb();
    db.delete(threadTags)
      .where(
        and(eq(threadTags.threadId, threadId), eq(threadTags.tagId, tagId)),
      )
      .run();
  }

  getTagsForThread(threadId: string): TagRow[] {
    const db = getDb();
    return db
      .select({
        id: tags.id,
        name: tags.name,
        emoji: tags.emoji,
        color: tags.color,
        sortOrder: tags.sortOrder,
        mode: tags.mode,
        createdAt: tags.createdAt,
      })
      .from(threadTags)
      .innerJoin(tags, eq(threadTags.tagId, tags.id))
      .where(eq(threadTags.threadId, threadId))
      .orderBy(asc(tags.sortOrder), asc(tags.name))
      .all();
  }

  purgeThreadTables(): void {
    const sqlite = getSqlite();
    sqlite.exec(`
      DROP TABLE IF EXISTS thread_tags;
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS tags;
      DROP TABLE IF EXISTS threads;
    `);
    logger.info("Thread tables purged. Run migrations to recreate.");
  }
}

export const threadPersistenceService = new ThreadPersistenceService();
