import { defineConfig } from "drizzle-kit";

// Only generates migrations from the schema, so it needs no database connection.
// Apply them with `npm run db:migrate` (scripts/db/migrate.mts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
});
