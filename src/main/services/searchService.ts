import type Database from "better-sqlite3";
import log from "electron-log/main";

interface ThreadRow {
  id: string;
  title: string;
  status: "regular" | "archived";
  created_at: string;
  updated_at: string;
}

interface TagRow {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

interface ThreadWithTags extends ThreadRow {
  tags: TagRow[];
}

const logger = log.scope("SearchService");

class SearchService {
  private db: Database.Database | null = null;

  initialize(db: Database.Database): void {
    this.db = db;
    this.createFtsTables();
    this.backfillIndex();
  }

  private createFtsTables(): void {
    if (!this.db) throw new Error("Database not initialized");

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS threads_fts USING fts5(
        thread_id UNINDEXED,
        title,
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS threads_fts_insert AFTER INSERT ON threads BEGIN
        INSERT INTO threads_fts(thread_id, title) VALUES (new.id, new.title);
      END;

      CREATE TRIGGER IF NOT EXISTS threads_fts_update AFTER UPDATE ON threads BEGIN
        DELETE FROM threads_fts WHERE thread_id = old.id;
        INSERT INTO threads_fts(thread_id, title) VALUES (new.id, new.title);
      END;

      CREATE TRIGGER IF NOT EXISTS threads_fts_delete AFTER DELETE ON threads BEGIN
        DELETE FROM threads_fts WHERE thread_id = old.id;
      END;
    `);
  }

  private backfillIndex(): void {
    if (!this.db) throw new Error("Database not initialized");

    const ftsCount = (
      this.db.prepare("SELECT count(*) AS cnt FROM threads_fts").get() as {
        cnt: number;
      }
    ).cnt;

    if (ftsCount === 0) {
      const threadCount = (
        this.db.prepare("SELECT count(*) AS cnt FROM threads").get() as {
          cnt: number;
        }
      ).cnt;

      if (threadCount > 0) {
        logger.info("Backfilling FTS index for existing threads");
        this.db.exec(`
          INSERT INTO threads_fts(thread_id, title)
          SELECT id, title FROM threads
        `);
      }
    }
  }

  searchThreads(
    query: string,
    getTagsForThread: (threadId: string) => TagRow[],
  ): ThreadWithTags[] {
    if (!this.db) throw new Error("Database not initialized");

    const trimmed = query.trim();
    if (!trimmed) return [];

    let threads: ThreadRow[];

    // Trigram tokenizer needs at least 1 CJK character or 3 latin chars.
    // Detect CJK to route short CJK queries to FTS.
    const hasCJK =
      /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]/.test(
        trimmed,
      );

    if (hasCJK || trimmed.length >= 3) {
      // Use FTS5 trigram search
      const stmt = this.db.prepare(`
        SELECT t.* FROM threads t
        WHERE t.id IN (
          SELECT thread_id FROM threads_fts WHERE threads_fts MATCH ?
        )
        ORDER BY t.updated_at DESC
      `);
      threads = stmt.all(trimmed) as ThreadRow[];
    } else {
      // LIKE fallback for short Latin queries (1-2 chars)
      const stmt = this.db.prepare(
        "SELECT * FROM threads WHERE title LIKE ? ORDER BY updated_at DESC",
      );
      threads = stmt.all(`%${trimmed}%`) as ThreadRow[];
    }

    return threads.map((thread) => ({
      ...thread,
      tags: getTagsForThread(thread.id),
    }));
  }

  close(): void {
    this.db = null;
  }
}

export const searchService = new SearchService();
