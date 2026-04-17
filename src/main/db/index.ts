import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import log from "electron-log/main";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = log.scope("Database");

let pglite: PGlite | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export async function initializeDatabase(): Promise<void> {
  const dbDir = path.join(app.getPath("userData"), "autai-pgdata");
  logger.info("Opening database", { dbDir });

  pglite = await PGlite.create({
    dataDir: dbDir,
    extensions: { pg_trgm },
  });

  db = drizzle({ client: pglite, schema });

  // Run pending migrations (including pg_trgm custom migration)
  await migrate(db, { migrationsFolder: path.join(__dirname, "drizzle") });

  logger.info("Database initialized and migrations applied");
}

export function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (pglite) {
    await pglite.close();
    pglite = null;
    db = null;
    logger.info("Database closed");
  }
}
