# Database

The hosted features (accounts and syncing leagues across devices) store data in Postgres. **The free, self-hosted app doesn't need a database.** Without `DATABASE_URL` the app never opens a connection.

## Contents

1. [Local Postgres](#1-local-postgres)
2. [Schema and migrations](#2-schema-and-migrations)
3. [Tests](#3-tests)
4. [League API](#4-league-api)
5. [Backups and restore](#5-backups-and-restore)
6. [AI plan costs](#6-ai-plan-costs)

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
| `ai_plans` | One row per league: its AI game plan and the background job that writes it. |
| `ai_generations` | Append-only: one row per AI model call, with token usage, cost in USD and outcome. See [§6](#6-ai-plan-costs). |

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

## 4. League API

The browser syncs through these routes. `src/lib/storage/server.ts` is their only caller, and UI code never uses them directly. Every route returns 404 when cloud features are off and 401 when signed out. Writes that carry another site's `Origin` get 403. Queries are limited to the signed-in user, so another user's league (or a deleted one) returns 404, the same as a league that doesn't exist.

| Route | Does |
|---|---|
| `GET /api/leagues` | `{ leagues }`, oldest first. |
| `PUT /api/leagues/:id` | Creates or updates a league from a `LeagueRecord`. The newest `updatedAt` wins: if the stored league is newer, it's returned with `applied: false`. Accounts are capped at 100 leagues (422). |
| `DELETE /api/leagues/:id` | Soft-deletes the league (204). |
| `GET /api/leagues/:id/draft` | `{ state, revision }`, where `state` is null and `revision` is 0 before the first save. |
| `PUT /api/leagues/:id/draft` | `{ state, baseRevision }`. Saves only if `baseRevision` is the stored revision and returns `{ revision }`. Otherwise it returns 409 with what's stored. |

Data access lives in `src/lib/server/leagues.ts`, and its tests (including the cross-user cases) run on PGlite.

## 5. Backups and restore

A self-hosted database with no backups is the most likely way to lose users' leagues. Back up before every deploy that runs migrations, and on a schedule.

### Taking a backup

```sh
DATABASE_URL=postgres://... npm run db:backup                 # writes backups/warroom-<UTC timestamp>.dump
DATABASE_URL=postgres://... npm run db:backup -- /var/backups/warroom
```

`scripts/db-backup.sh` runs `pg_dump` in custom format (compressed, restorable table by table) and writes to a `.partial` file first. It checks the dump with `pg_restore --list` before renaming it, so a file with a final name is always readable. `backups/` is git-ignored.

The scripts need the Postgres client tools (`pg_dump`, `pg_restore`) at the server's major version, 17. If those aren't installed but Postgres runs in Docker, set `PG_DOCKER_CONTAINER=<container name>` to run the tools inside that container. `DATABASE_URL` is then resolved from inside the container, e.g. `postgres://warroom:warroom@localhost:5432/warroom`.

### Restoring

```sh
DATABASE_URL=postgres://... npm run db:restore -- backups/warroom-20260916T124920Z.dump --yes
```

This replaces every table with the dump's contents in a single transaction. If anything fails, the database is left as it was. Without `--yes` the script only explains what it would do.

Runbook:

1. **Stop the app** so nothing writes during the restore. Browsers keep unsynced picks locally and push them once the app is back.
2. **Take a backup of the current state first**, even if it's broken. That keeps the restore reversible.
3. Run `npm run db:restore -- <dump> --yes`.
4. Run `npm run db:migrate`. It's a no-op if the dump came from the current schema, and it upgrades an older dump.
5. Start the app, sign in, and check that leagues load.

### Restore drill

Do this before relying on backups, and again after changing Postgres versions. It was last run on 2026-09-16 against the dev container: counts and a checksum of every draft matched before the wipe and after the restore.

```sh
export DATABASE_URL=postgres://warroom:warroom@localhost:5432/warroom PG_DOCKER_CONTAINER=<dev db container>
npm run db:backup
docker exec "$PG_DOCKER_CONTAINER" psql -U warroom -d warroom -c "drop schema public cascade; create schema public;"
npm run db:restore -- backups/<the dump> --yes
docker exec "$PG_DOCKER_CONTAINER" psql -U warroom -d warroom -c "select count(*) from leagues"
```

### Not covered here

The hosted droplet backs up nightly with a systemd timer and before every deploy, and keeps 14 days of dumps. See [deployment.md §8](deployment.md#8-backups). Off the server, DigitalOcean's weekly droplet backups include the dumps. A backup that only lives on the database's own disk doesn't survive losing that disk.

## 6. AI plan costs

Every model call made for an AI game plan is logged in `ai_generations`, including calls that failed or were outrun by a newer request, since those are paid for too. Cost is priced when the row is written, from `src/lib/ai/pricing.ts`. Update that table when a provider's prices change; rows already logged keep the price that applied at the time.

```sh
npm run ai:costs                                        # the last 30 days
npm run ai:costs -- --from 2026-09-01 --to 2026-10-01   # UTC dates, end exclusive
npm run ai:costs -- --json
```

The headline is **average cost per league**: all calls for a league, including retries and regenerations, divided by the number of leagues. Check it against the price one league pays. The same numbers in SQL:

```sql
select count(*)                                   as calls,
       count(distinct league_id)                  as leagues,
       sum(cost_usd)                              as total_usd,
       sum(cost_usd) / nullif(count(distinct league_id), 0) as avg_usd_per_league
from ai_generations
where created_at >= '2026-09-01' and created_at < '2026-10-01';
```

Calls with a null `cost_usd` have no known price, or reported no usage (for example, a call cut off at its deadline). They're left out of the totals.
