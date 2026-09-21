# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

Node 22+ required (`.nvmrc` pins 24).

```sh
npm run dev          # http://localhost:3000
npm run typecheck    # next typegen && tsc --noEmit
npm run lint         # eslint .
npm test             # vitest run
npm run build        # runs check-data first via prebuild
npm run check-data   # validates the loaded player dataset only
npm run db:generate  # after editing src/lib/db/schema.ts: writes a migration into drizzle/
npm run db:migrate   # applies migrations to DATABASE_URL (see docs/database.md)
```

CI (`.github/workflows/ci.yml`) runs typecheck → lint → test → build on every PR; all four must pass.

Single test file / single test:

```sh
npx vitest run src/lib/draft/snake.test.ts
npx vitest run -t "snake"          # by test name
npx vitest src/lib/draft           # watch mode on a directory
```

Vitest only picks up `src/**/*.test.ts` (node environment, `@` → `src`). There are no component/DOM tests — tests target `src/lib/`: the pure engine, the stores (with an in-memory `Storage`), and the database layer on PGlite.

## Architecture

A Next.js 16 App Router app with two pages — a door and a room — plus API routes for hosted features. `src/app/draft/page.tsx` calls `connection()` (so flags reflect runtime, not build-time env) and renders `<WarRoom flags={publicFlags} user={await getSessionUser()}>`; everything below it is client-side. `src/app/page.tsx` is the hosted site's landing page (`src/components/landing/`); it forwards to `/draft` whenever cloud features are off (self-hosting), the visitor has a session, or a league is saved on this device, carrying the query string along. With cloud features off (the default), all state lives in the browser and the API routes 404.

**Three layers, strictly separated:**

1. `src/lib/draft/` — the draft engine. Pure TypeScript: no React, DOM, storage, or `process.env`. Snake-pick math (`snake.ts`), the draft reducer (`state.ts`), Fisher–Jenks tiering (`tiers.ts`), ADP-vs-consensus Value/Reach tags (`value.ts`), roster slotting (`roster.ts`), league validation (`league.ts`). `types.ts` is the domain vocabulary.
2. `src/lib/draft/sim/` — the Monte Carlo mock-draft simulator. `cpu.ts` scores picks per CPU style, `simulate.ts` runs a draft forward, `availability.ts` computes survival odds ("will he last to my next turn?"), `turnPlan.ts` turns those odds into the live plan. `availability.worker.ts` runs it off the main thread; `useAvailability.ts` owns that worker. The UI runs 100 mocks for the live turn plan and 300 for the availability report.
3. `src/components/draft/` — the client UI, composed of nested context providers in `WarRoom.tsx`: Flags → Toast/Confirm → Prefs → League → Draft → DraftModel → Sim. `DraftModel.tsx` derives everything the views read (tiers, tags, availability) from league + picks; the views (`FocusView`, `Board`, `RosterPanels`, `Simulator`, …) are presentational.

**Data.** `src/lib/data/index.ts` exports a single `dataset`, validated at import time by `loadDataset.ts` (throws `DatasetError` naming the first bad field). Self-hosters swap `sample-2026.json`, which is why `check-data` runs before every build. `scripts/extract-prototype-data.mts` regenerated that JSON from the prototype once; its output is committed.

**Persistence.** UI code never touches `localStorage` or `fetch` for data — it calls `getStores()` from `@/lib/storage`. `configureStores()` (called by `WarRoom`, whose provider tree is keyed by user) picks `createLocalStores()` when signed out, or `createServerStores()` when signed in: local-first writes into a per-user localStorage cache, pushed to `/api/leagues` by a background queue (see the header comment in `storage/server.ts`). Leagues are `LeagueRecord`s with ids; drafts are keyed by league id. `UiPrefs` stay device-local and never sync. Validators in `storage/records.ts` are shared by the browser and the API.

**Hosted (cloud) features.** `src/lib/db/` is the Drizzle schema (`getDb()` connects lazily; tests use `createTestDb()` on PGlite, no Docker). `src/lib/auth/` is Auth.js v5 with database sessions, built per request and null when cloud is off. `src/lib/server/leagues.ts` is user-scoped data access used by the route handlers in `src/app/api/leagues/`, which are wrapped in `withUser()` (404 when cloud off, 401 signed out, 403 cross-origin writes). Migrations in `drizzle/` are generated, committed, and never hand-edited.

**Deployment.** The hosted app runs on one droplet without Docker: `deploy/warroom.service` (systemd, `next start` on localhost), `deploy/Caddyfile` (TLS), and `deploy/deploy.sh`, which builds each commit into `releases/<sha>`, backs up and migrates the database, then swaps the `current` symlink (`deploy.sh rollback` swaps back; migrations aren't reverted). `deploy/warroom-backup.timer` backs up nightly. `src/instrumentation.ts` logs server errors as `[server-error]` lines, which `deploy/warroom-alerts.sh` (timer + `OnFailure=`) emails through Resend. `.github/workflows/deploy.yml` deploys `main` after CI passes, over SSH through the forced command `deploy/ci-deploy.sh`. The runbook is `docs/deployment.md`; `docker-compose.dev.yml` is only for local Postgres.

**Config.** `src/lib/config.ts` is `server-only` and the only module allowed to read `process.env`. The app must boot with zero env vars set; hosted features (`cloudEnabled`, `aiEnabled`, `paymentsEnabled`, `dataPipelineEnabled`) switch on when their credentials appear, and partial setups warn rather than throw. Client components get booleans via the `publicFlags` prop, never `config`. New env vars go in both `config.ts` and `.env.example`.

Two of these rules are ESLint-enforced (`eslint.config.mjs`): direct `process.env` access outside `config.ts` (and the two CLI env readers), and direct `localStorage`/`sessionStorage` access outside `src/lib/storage/`, are errors.

## Conventions

- **Never hardcode league shape.** Teams, draft slot, scoring, and rounds (`roster.length`) always come from `LeagueSettings`. No literal 12 or 16.
- **Injected randomness.** Anything random takes an `rng: Rng` (`mulberry32`) so tests can seed it. No bare `Math.random()` in the engine.
- **Styling:** Tailwind v4 with tokens declared in the `@theme` block of `src/app/globals.css`; use token utilities (`bg-panel`, `text-muted`, `border-qb`), never raw hex. The war room itself uses one CSS module, `warRoom.module.css`, ported from the prototype with its class structure intact; join its classes with `cx()`/`s()` from `cx.ts`. Dark-only.
- `prototype/war_room.html` is a frozen reference for behavior and styling — lint-ignored, never modified. Much of `src/lib/` is a direct port of it, and comments cite the original function names (`takenMap()`, `runReport()`, `tagFor()`).
- Branch off `main`, one change per PR (see `CONTRIBUTING.md`).
