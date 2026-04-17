import { getDb } from "@/db";
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

  async createThread(id: string): Promise<ThreadRow> {
    const db = getDb();
    await db.insert(threads).values({ id });
    return (await this.getThread(id))!;
  }

  async listThreads(): Promise<ThreadWithTags[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(threads)
      .where(eq(threads.status, "regular"))
      .orderBy(desc(threads.updatedAt));

    const result: ThreadWithTags[] = [];
    for (const thread of rows) {
      result.push({
        ...thread,
        tags: await this.getTagsForThread(thread.id),
      });
    }
    return result;
  }

  async listAllThreads(): Promise<ThreadWithTags[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(threads)
      .orderBy(desc(threads.updatedAt));

    const result: ThreadWithTags[] = [];
    for (const thread of rows) {
      result.push({
        ...thread,
        tags: await this.getTagsForThread(thread.id),
      });
    }
    return result;
  }

  async deleteAllThreads(status?: "regular" | "archived"): Promise<void> {
    const db = getDb();
    if (status) {
      await db.delete(threads).where(eq(threads.status, status));
    } else {
      await db.delete(threads);
    }
  }

  async archiveAllThreads(): Promise<void> {
    const db = getDb();
    await db
      .update(threads)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(threads.status, "regular"));
  }

  async getThread(id: string): Promise<ThreadRow | undefined> {
    const db = getDb();
    const rows = await db.select().from(threads).where(eq(threads.id, id));
    return rows[0];
  }

  async renameThread(id: string, title: string): Promise<void> {
    const db = getDb();
    await db
      .update(threads)
      .set({ title, updatedAt: new Date() })
      .where(eq(threads.id, id));
  }

  async archiveThread(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(threads)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(threads.id, id));
  }

  async unarchiveThread(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(threads)
      .set({ status: "regular", updatedAt: new Date() })
      .where(eq(threads.id, id));
  }

  async deleteThread(id: string): Promise<void> {
    const db = getDb();
    await db.delete(threads).where(eq(threads.id, id));
  }

  async saveMessages(threadId: string, msgs: UIMessage[]): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .update(threads)
        .set({ updatedAt: new Date() })
        .where(eq(threads.id, threadId));

      await tx.delete(messages).where(eq(messages.threadId, threadId));
      for (const msg of msgs) {
        await tx.insert(messages).values({
          id: msg.id,
          threadId,
          role: msg.role,
          content: JSON.stringify(msg),
        });
      }
    });
  }

  async loadMessages(threadId: string): Promise<UIMessage[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt));

    return rows.map((row) => JSON.parse(row.content) as UIMessage);
  }

  // ---------------------------------------------------------------------------
  // Tag operations
  // ---------------------------------------------------------------------------

  async createTag(name: string, sortOrder?: number): Promise<TagRow> {
    const db = getDb();
    const [result] = await db
      .insert(tags)
      .values({ name, sortOrder: sortOrder ?? 0 })
      .returning();
    return result;
  }

  async listTags(): Promise<TagRow[]> {
    const db = getDb();
    return db.select().from(tags).orderBy(asc(tags.sortOrder), asc(tags.name));
  }

  async getTag(id: number): Promise<TagRow | undefined> {
    const db = getDb();
    const rows = await db.select().from(tags).where(eq(tags.id, id));
    return rows[0];
  }

  async renameTag(id: number, name: string): Promise<void> {
    const db = getDb();
    await db.update(tags).set({ name }).where(eq(tags.id, id));
  }

  async deleteTag(id: number): Promise<void> {
    const db = getDb();
    await db.delete(tags).where(eq(tags.id, id));
  }

  async addTagToThread(threadId: string, tagId: number): Promise<void> {
    const db = getDb();
    await db
      .insert(threadTags)
      .values({ threadId, tagId })
      .onConflictDoNothing();
  }

  async removeTagFromThread(threadId: string, tagId: number): Promise<void> {
    const db = getDb();
    await db
      .delete(threadTags)
      .where(
        and(eq(threadTags.threadId, threadId), eq(threadTags.tagId, tagId)),
      );
  }

  async getTagsForThread(threadId: string): Promise<TagRow[]> {
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
      .orderBy(asc(tags.sortOrder), asc(tags.name));
  }

  async purgeThreadTables(): Promise<void> {
    const db = getDb();
    await db.execute(sql`DROP TABLE IF EXISTS thread_tags`);
    await db.execute(sql`DROP TABLE IF EXISTS messages`);
    await db.execute(sql`DROP TABLE IF EXISTS tags`);
    await db.execute(sql`DROP TABLE IF EXISTS threads`);
    logger.info("Thread tables purged. Run migrations to recreate.");
  }
}

export const threadPersistenceService = new ThreadPersistenceService();
