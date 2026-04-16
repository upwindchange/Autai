import { getSqlite } from "@/db";
import log from "electron-log/main";
import type { TagRow, ThreadRow, ThreadWithTags } from "@/db/types";

const logger = log.scope("SearchService");

class SearchService {
  initialize(): void {
    // FTS5 table and triggers are created by migration.
    // Backfill is handled by migration as well.
    logger.info("SearchService ready");
  }

  searchThreads(
    query: string,
    getTagsForThread: (threadId: string) => TagRow[],
  ): ThreadWithTags[] {
    const sqlite = getSqlite();
    const trimmed = query.trim();
    if (!trimmed) return [];

    let rows: ThreadRow[];

    // Trigram tokenizer needs at least 1 CJK character or 3 latin chars.
    // Detect CJK to route short CJK queries to FTS.
    const hasCJK =
      /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]/.test(
        trimmed,
      );

    if (hasCJK || trimmed.length >= 3) {
      // Use FTS5 trigram search
      const stmt = sqlite.prepare(`
        SELECT t.* FROM threads t
        WHERE t.id IN (
          SELECT thread_id FROM threads_fts WHERE threads_fts MATCH ?
        )
        ORDER BY t.updated_at DESC
      `);
      rows = stmt.all(trimmed) as ThreadRow[];
    } else {
      // LIKE fallback for short Latin queries (1-2 chars)
      const stmt = sqlite.prepare(
        "SELECT * FROM threads WHERE title LIKE ? ORDER BY updated_at DESC",
      );
      rows = stmt.all(`%${trimmed}%`) as ThreadRow[];
    }

    return rows.map((thread) => ({
      ...thread,
      tags: getTagsForThread(thread.id),
    }));
  }
}

export const searchService = new SearchService();
