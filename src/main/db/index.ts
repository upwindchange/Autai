import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import log from "electron-log/main";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = log.scope("Database");

let sqlite: Database.Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function initializeDatabase(): void {
  const dbPath = path.join(app.getPath("userData"), "autai.db");
  logger.info("Opening database", { dbPath });

  sqlite = new Database(dbPath, {
    nativeBinding: path.join(__dirname, "better_sqlite3.node"),
  });
  sqlite.pragma("journal_mode = WAL");

  db = drizzle({ client: sqlite, schema });

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
