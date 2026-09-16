# Database

The hosted features (accounts and syncing leagues across devices) store data in Postgres. **The free, self-hosted app doesn't need a database.** Without `DATABASE_URL` the app never opens a connection.

## Contents

1. [Local Postgres](#1-local-postgres)
2. [Schema and migrations](#2-schema-and-migrations)
3. [Tests](#3-tests)

---

## 1. Local Postgres

`docker-compose.dev.yml` runs Postgres 17 on `127.0.0.1:5432`:

```sh
npm run db:up        # docker compose -f docker-compose.dev.yml up -d --wait
```

Then add this to `.env.local`:

```sh
DATABASE_URL=postgres://warroom:warroom@localhost:5432/warroom
```

Data persists in the `db-data` Docker volume. To wipe it, run `docker compose -f docker-compose.dev.yml down -v`.

## 2. Schema and migrations

The schema lives in `src/lib/db/schema.ts`, written with [Drizzle](https://orm.drizzle.team). Migrations are plain SQL files in `drizzle/` and are committed.

| Table | Holds |
|---|---|
| `users`, `accounts`, `sessions`, `verification_tokens` | Auth.js sign-in data. Their property names must match what `@auth/drizzle-adapter` expects. |
| `leagues` | One row per league: settings as JSON, the dataset fingerprint, and a soft-delete `deleted_at`. |
| `drafts` | One row per league: the picks as JSON, plus a `revision` that increases on every save. |
| `entitlements` | What a league has paid for. Written by the payments feature. |

To change the schema:

```sh
# 1. edit src/lib/db/schema.ts
npm run db:generate   # writes drizzle/NNNN_*.sql
npm run db:migrate    # applies pending migrations to DATABASE_URL
# 2. commit the schema change and the new migration together
```

`db:migrate` is safe to re-run, since migrations that are already applied are skipped. Run it before starting a new build in production.

## 3. Tests

Database tests use [PGlite](https://pglite.dev), which is Postgres compiled to WebAssembly and running in-process. `npm test` and CI need no Docker or database server. `createTestDb()` in `src/lib/db/testing.ts` returns a fresh database with every committed migration applied, so a migration that doesn't run on a clean database fails the tests.
