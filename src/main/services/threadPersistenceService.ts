import { getDb, getSqlite } from "@/db";
import { threads, messages, tags, threadTags } from "@/db/schema";
import { eq, desc, asc, sql, and } from "drizzle-orm";
import type { UIMessage } from "ai";
import log from "electron-log/main";
import type { ThreadRow, TagRow, ThreadWithTags } from "@/db/types";

const logger = log.scope("ThreadPersistenceService");

class ThreadPersistenceService {
  initialize(): void {
    // DB is already initialized by initializeDatabase() in @/db
    logger.info("ThreadPersistenceService ready");
  }

  createThread(id: string): ThreadRow {
    const db = getDb();
    db.insert(threads).values({ id }).run();
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

  deleteAllThreads(status?: "regular" | "archived"): void {
    const db = getDb();
    if (status) {
      db.delete(threads).where(eq(threads.status, status)).run();
    } else {
      db.delete(threads).run();
    }
  }

  archiveAllThreads(): void {
    const db = getDb();
    db.update(threads)
      .set({ status: "archived", updatedAt: sql`(datetime('now'))` })
      .where(eq(threads.status, "regular"))
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

  saveMessages(threadId: string, msgs: UIMessage[]): void {
    const db = getDb();
    db.transaction((tx) => {
      tx.update(threads)
        .set({ updatedAt: sql`(datetime('now'))` })
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

  createTag(name: string, sortOrder?: number): TagRow {
    const db = getDb();
    const result = db
      .insert(tags)
      .values({ name, sortOrder: sortOrder ?? 0 })
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

  getTag(id: number): TagRow | undefined {
    const db = getDb();
    return db.select().from(tags).where(eq(tags.id, id)).get();
  }

  renameTag(id: number, name: string): void {
    const db = getDb();
    db.update(tags).set({ name }).where(eq(tags.id, id)).run();
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
        sortOrder: tags.sortOrder,
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
