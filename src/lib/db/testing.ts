import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";
import type { Db } from "./types";

const MIGRATIONS = fileURLToPath(new URL("../../../drizzle", import.meta.url));

/**
 * A fresh in-memory Postgres (PGlite) with every committed migration applied.
 * For tests only: runs in plain `npm test` and CI with no Docker or database server.
 */
export async function createTestDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, close: () => client.close() };
}

/** Inserts a user and returns its id. */
export async function createTestUser(db: Db, email = `${crypto.randomUUID()}@example.test`): Promise<string> {
  const [user] = await db.insert(schema.users).values({ email }).returning({ id: schema.users.id });
  return user.id;
}
