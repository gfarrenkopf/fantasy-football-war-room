import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "@/lib/config";
import * as schema from "./schema";
import type { Db } from "./types";

export type { Db } from "./types";
export { schema };

// Kept on globalThis so dev-server hot reloads reuse one pool instead of leaking connections.
const globalForDb = globalThis as typeof globalThis & { fwrDb?: Db };

/**
 * The app's database. Connects on first use, never at import, so the app builds and boots
 * with no DATABASE_URL. Callers must check `config.cloudEnabled` first.
 */
export function getDb(): Db {
  if (!config.databaseUrl) throw new Error("getDb() called without DATABASE_URL; check config.cloudEnabled first.");
  globalForDb.fwrDb ??= drizzle(new Pool({ connectionString: config.databaseUrl, max: 10 }), { schema });
  return globalForDb.fwrDb;
}
