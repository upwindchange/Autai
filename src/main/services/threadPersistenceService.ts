import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { UIMessage } from "ai";
import log from "electron-log/main";
import { searchService } from "./searchService";

// __dirname equivalent for ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const logger = log.scope("ThreadPersistenceService");

interface ThreadRow {
  id: string;
  title: string;
  status: "regular" | "archived";
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  created_at: string;
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

class ThreadPersistenceService {
  private db: Database.Database | null = null;

  initialize(): void {
    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "autai.db");
    logger.info("Initializing database", { dbPath });

    this.db = new Database(dbPath, {
      nativeBinding: path.join(__dirname, "better_sqlite3.node"),
    });

    // Enable WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");

    this.createTables();

    // Initialize search service with the shared database connection
    searchService.initialize(this.db);
  }

  private createTables(): void {
    if (!this.db) throw new Error("Database not initialized");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        status TEXT NOT NULL DEFAULT 'regular',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS thread_tags (
        thread_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (thread_id, tag_id),
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_thread_tags_tag_id ON thread_tags(tag_id);
    `);
  }

  createThread(id: string): ThreadRow {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("INSERT INTO threads (id) VALUES (?)");
    stmt.run(id);
    return this.getThread(id)!;
  }

  listThreads(): ThreadWithTags[] {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "SELECT * FROM threads WHERE status = 'regular' ORDER BY updated_at DESC",
    );
    const threads = stmt.all() as ThreadRow[];

    return threads.map((thread) => ({
      ...thread,
      tags: this.getTagsForThread(thread.id),
    }));
  }

  listAllThreads(): ThreadWithTags[] {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "SELECT * FROM threads ORDER BY updated_at DESC",
    );
    const threads = stmt.all() as ThreadRow[];

    return threads.map((thread) => ({
      ...thread,
      tags: this.getTagsForThread(thread.id),
    }));
  }

  deleteAllThreads(status?: "regular" | "archived"): void {
    if (!this.db) throw new Error("Database not initialized");

    if (status) {
      const stmt = this.db.prepare("DELETE FROM threads WHERE status = ?");
      stmt.run(status);
    } else {
      const stmt = this.db.prepare("DELETE FROM threads");
      stmt.run();
    }
  }

  archiveAllThreads(): void {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "UPDATE threads SET status = 'archived', updated_at = datetime('now') WHERE status = 'regular'",
    );
    stmt.run();
  }

  getThread(id: string): ThreadRow | undefined {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("SELECT * FROM threads WHERE id = ?");
    return stmt.get(id) as ThreadRow | undefined;
  }

  renameThread(id: string, title: string): void {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "UPDATE threads SET title = ?, updated_at = datetime('now') WHERE id = ?",
    );
    stmt.run(title, id);
  }

  archiveThread(id: string): void {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "UPDATE threads SET status = 'archived', updated_at = datetime('now') WHERE id = ?",
    );
    stmt.run(id);
  }

  unarchiveThread(id: string): void {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "UPDATE threads SET status = 'regular', updated_at = datetime('now') WHERE id = ?",
    );
    stmt.run(id);
  }

  deleteThread(id: string): void {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("DELETE FROM threads WHERE id = ?");
    stmt.run(id);
  }

  saveMessages(threadId: string, messages: UIMessage[]): void {
    if (!this.db) throw new Error("Database not initialized");

    // Update thread's updated_at timestamp
    const updateStmt = this.db.prepare(
      "UPDATE threads SET updated_at = datetime('now') WHERE id = ?",
    );

    // Delete existing messages and insert new ones in a transaction
    const deleteStmt = this.db.prepare(
      "DELETE FROM messages WHERE thread_id = ?",
    );
    const insertStmt = this.db.prepare(
      "INSERT INTO messages (id, thread_id, role, content) VALUES (?, ?, ?, ?)",
    );

    const transaction = this.db.transaction(() => {
      updateStmt.run(threadId);
      deleteStmt.run(threadId);
      for (const msg of messages) {
        insertStmt.run(msg.id, threadId, msg.role, JSON.stringify(msg));
      }
    });

    transaction();
  }

  loadMessages(threadId: string): UIMessage[] {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC",
    );
    const rows = stmt.all(threadId) as MessageRow[];

    return rows.map((row) => JSON.parse(row.content) as UIMessage);
  }

  // ---------------------------------------------------------------------------
  // Tag operations
  // ---------------------------------------------------------------------------

  createTag(name: string, sortOrder?: number): TagRow {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "INSERT INTO tags (name, sort_order) VALUES (?, ?)",
    );
    const result = stmt.run(name, sortOrder ?? 0);
    return this.getTag(result.lastInsertRowid as number)!;
  }

  listTags(): TagRow[] {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "SELECT * FROM tags ORDER BY sort_order ASC, name ASC",
    );
    return stmt.all() as TagRow[];
  }

  getTag(id: number): TagRow | undefined {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("SELECT * FROM tags WHERE id = ?");
    return stmt.get(id) as TagRow | undefined;
  }

  renameTag(id: number, name: string): void {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("UPDATE tags SET name = ? WHERE id = ?");
    stmt.run(name, id);
  }

  deleteTag(id: number): void {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare("DELETE FROM tags WHERE id = ?");
    stmt.run(id);
  }

  addTagToThread(threadId: string, tagId: number): void {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) VALUES (?, ?)",
    );
    stmt.run(threadId, tagId);
  }

  removeTagFromThread(threadId: string, tagId: number): void {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "DELETE FROM thread_tags WHERE thread_id = ? AND tag_id = ?",
    );
    stmt.run(threadId, tagId);
  }

  getTagsForThread(threadId: string): TagRow[] {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "SELECT t.* FROM tags t INNER JOIN thread_tags tt ON t.id = tt.tag_id WHERE tt.thread_id = ? ORDER BY t.sort_order ASC, t.name ASC",
    );
    return stmt.all(threadId) as TagRow[];
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info("Database connection closed");
    }
  }
}

export const threadPersistenceService = new ThreadPersistenceService();
