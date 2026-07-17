import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import log from "electron-log/main";
// Note: schema is not passed to `drizzle()` below. In drizzle-orm v1 the
// better-sqlite3 config omits `schema` (relational config moved to a separate
// `relations` field), and this project uses the regular query builder (tables
// imported directly at each call site), not the `db.query.*` relational API —
// so nothing here needs schema wiring.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = log.scope("Database");

let sqlite: Database.Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function initializeDatabase(): void {
  const dbPath = path.join(app.getPath("userData"), "autai.db");
  logger.info("Opening database", { dbPath });

  const bindingPath = path.join(__dirname, "better_sqlite3.node");

  sqlite = new Database(dbPath, {
    nativeBinding: fs.realpathSync.native(bindingPath),
  });
  sqlite.pragma("journal_mode = WAL");
  // Enable FK enforcement (OFF by default in SQLite, per-connection). Required
  // for the rewritten_chapters→source_chapters ON DELETE CASCADE (and every
  // other cascade in the schema) to actually fire. Without this all
  // `references(..., { onDelete: "cascade" })` declarations are cosmetic.
  sqlite.pragma("foreign_keys = ON");

  db = drizzle({ client: sqlite });

  // Run pending migrations (including FTS5 custom migration)
  migrate(db, { migrationsFolder: path.join(__dirname, "drizzle") });

  logger.info("Database initialized and migrations applied");
}

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function getSqlite() {
  if (!sqlite) throw new Error("Database not initialized");
  return sqlite;
}

export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
    logger.info("Database closed");
  }
}
