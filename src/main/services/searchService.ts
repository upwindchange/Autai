import { getDb } from "@/db";
import { threads } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import log from "electron-log/main";
import type { TagRow, ThreadWithTags } from "@/db/types";

const logger = log.scope("SearchService");

class SearchService {
  initialize(): void {
    // pg_trgm extension and GIN index are created by migration.
    logger.info("SearchService ready");
  }

  async searchThreads(
    query: string,
    getTagsForThread: (threadId: string) => Promise<TagRow[]>,
  ): Promise<ThreadWithTags[]> {
    const db = getDb();
    const trimmed = query.trim();
    if (!trimmed) return [];

    const rows = await db
      .select()
      .from(threads)
      .where(sql`title ILIKE ${"%" + trimmed + "%"}`)
      .orderBy(desc(threads.updatedAt));

    const result: ThreadWithTags[] = [];
    for (const thread of rows) {
      result.push({
        ...thread,
        tags: await getTagsForThread(thread.id),
      });
    }
    return result;
  }
}

export const searchService = new SearchService();
