/**
 * Applies committed migrations from drizzle/ to DATABASE_URL. Safe to re-run: applied
 * migrations are tracked in the database and skipped.
 *
 *   npm run db:migrate
 *
 * Like the ingestion CLI, this reads .env.local (via --env-file-if-exists) and is one of the
 * few places outside src/lib/config.ts allowed to read process.env.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local; see docs/database.md.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  console.log("Migrations applied.");
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
