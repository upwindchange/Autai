import { app } from "electron";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type BetterSqlite3 from "better-sqlite3";
import type { UIMessage } from "ai";
import log from "electron-log/main";

// better-sqlite3 is a CJS native module — load via createRequire for ESM compat
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof BetterSqlite3;

// __dirname equivalent for ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const logger = log.scope("ThreadPersistenceService");

interface ThreadRow {
  id: string;
  title: string | null;
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

class ThreadPersistenceService {
  private db: BetterSqlite3.Database | null = null;

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
  }

  private createTables(): void {
    if (!this.db) throw new Error("Database not initialized");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT,
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
    `);
  }

  createThread(id: string): ThreadRow {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "INSERT INTO threads (id) VALUES (?)",
    );
    stmt.run(id);
    return this.getThread(id)!;
  }

  listThreads(): ThreadRow[] {
    if (!this.db) throw new Error("Database not initialized");

    const stmt = this.db.prepare(
      "SELECT * FROM threads WHERE status = 'regular' ORDER BY updated_at DESC",
    );
    return stmt.all() as ThreadRow[];
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

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info("Database connection closed");
    }
  }
}

export const threadPersistenceService = new ThreadPersistenceService();
