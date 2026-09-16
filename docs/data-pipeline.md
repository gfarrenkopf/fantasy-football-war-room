# Data pipeline

Ingests ADP, projections and bye weeks from [SportsDataIO](https://sportsdata.io) and turns them into a dataset the app can load.

The app does **not** need this. The free draft room ships with a sample dataset and runs with zero environment variables; see [self-hosting](self-hosting.md). This is for keeping a board current during draft season.

## Contents

1. [What it does](#1-what-it-does)
2. [Running it](#2-running-it)
3. [Where the output goes](#3-where-the-output-goes)
4. [Using a run's output in the app](#4-using-a-runs-output-in-the-app)
5. [The QA gate](#5-the-qa-gate)
6. [How consensusRank is derived](#6-how-consensusrank-is-derived)
7. [Known limitations](#7-known-limitations)

---

## 1. What it does

One run fetches three endpoints, joins them, derives the ranking columns, checks the result, and publishes only if everything passes.

| Endpoint | Supplies |
|---|---|
| `stats/json/FantasyPlayers` | ADP (standard and full PPR), team, position, bye week |
| `projections/json/PlayerSeasonProjectionStats/{season}REG` | projected season points, joined on `PlayerID` |
| `scores/json/Byes/{season}` | authoritative bye weeks per team |

Everything else — tiers, Value/Reach tags, the turn plan — is computed by the app at runtime from the user's own league settings. The pipeline does not precompute any of it, because all of it depends on league size and roster shape.

## 2. Running it

Put your key in `.env.local`:

```sh
SPORTSDATA_API_KEY=your-key-here
```

Then:

```sh
npm run ingest -- --dry-run          # fetch, normalize, check, print the changelog; publish nothing
npm run ingest                       # the same, but publish if the QA gate passes
npm run ingest -- --from <run-id>    # re-normalize a stored run without re-fetching
npm run ingest -- --list             # list stored runs
npm run ingest -- --rollback         # republish the previous run
npm run ingest -- --rollback <run-id>
npm run ingest -- --season 2027      # default is 2026
```

`--from` matters more than it looks: it re-runs normalization against the raw responses already on disk, so you can iterate on the pipeline without spending API quota or waiting on the network.

`--rollback` publishes whatever you point it at without re-running the QA gate. It's an operator escape hatch for "the current board is wrong, put the old one back now."

Fixtures for the test suite are captured separately, and only need re-running when the upstream response shape changes:

```sh
npm run capture-fixtures
```

## 3. Where the output goes

```
data/snapshots/<run-id>/raw/*.json      untouched API responses
data/snapshots/<run-id>/dataset.json    normalized, validated dataset
data/snapshots/<run-id>/report.json     QA findings, tier summary, changelog
data/live.json                          the published dataset
```

`data/` is git-ignored: raw responses are large and re-fetchable, and what's "live" is specific to your machine. Run ids are UTC timestamps, so they sort chronologically.

Keeping the raw responses is what makes `--from` and rollback cheap, and means a bad normalization never costs you a re-fetch.

## 4. Using a run's output in the app

Publishing writes `data/live.json`. The app loads its dataset through a static import in `src/lib/data/index.ts`, resolved at build time, so pointing the app at a run is the same two steps as [using your own player data](self-hosting.md#5-use-your-own-player-data):

1. Copy `data/live.json` to `src/lib/data/`.
2. Change the import in `src/lib/data/index.ts` to `./live.json`.
3. `npm run build && npm start`.

This is deliberately a manual step rather than automatic. A generated file that the build silently prefers is a good way to draft on data you didn't realise had changed.

## 5. The QA gate

A run publishes only if every check passes. Failures block; warnings are recorded in `report.json` and let the run through. A blocked run still writes its snapshot and report — so you can inspect exactly what was wrong — and leaves `data/live.json` untouched.

**Structural** (shared with `npm run check-data`, so the rules can't drift): bye weeks present and matching, contiguous position ranks, unique ids, enough players and enough K/DST for at least a 10-team league.

**Plausibility**: projections within per-position ceilings; no kicker or defense projected like a first-rounder; the best player at each position clearing a floor.

**Distributional**: no single projection or ADP value shared by a quarter of the league — the signature of placeholder data.

**Tier and tag sanity**: tiers computed for all three league presets, every real tier populated, and the Value/Reach distribution neither collapsed into "even" (which means `consensusRank` and `adp` have merged) nor dominated by one tag (which usually means they're on different scales).

Datasets without projections are a supported case — the shipped sample is one — and every projection check is skipped for them.

### On the free trial

The free tier's projections are roughly half a real season: it returns a top RB around 181 points in full PPR, where a real leader is 350+. **The gate correctly refuses to publish this**, which is the intended behaviour, not a bug:

```
FAIL [projection-floor] best RB is projected for only 181 points (expected at least 250 in full PPR)
```

Use `--dry-run` while on the trial. With a paid key, the same command publishes.

## 6. How consensusRank is derived

`Dataset` carries two independent rankings, and the Value/Reach feature is the gap between them: `valueTag()` is `adp - consensusRank`. SportsDataIO has no expert consensus rank, so the pipeline builds one from projections.

**Ranking on raw projected points does not work.** Quarterbacks score far more raw points than anyone else, so a raw ranking puts about 21 QBs in the first 36 picks and would tag every QB a huge Value and every RB a Reach.

Instead, players are ranked by **value over replacement**: what a player scores above the last startable player at his own position. That makes positions comparable, and is what expert consensus rank approximates. Measured against the 2026 data, it produces a first-36 makeup of RB 18 / WR 15 / TE 2 / QB 1, against the actual ADP's RB 17 / WR 16 / TE 2 / QB 1 — while staying computed from projections rather than from ADP.

Two consequences worth knowing:

- **Value/Reach now means projection-vs-market, not experts-vs-market.** If you supply your own file with a real ECR in `consensusRank`, it keeps the original meaning; both are valid.
- **Replacement level assumes a canonical 12-team league** (`REPLACEMENT_STARTERS` in `pipeline/ranks.ts`). `consensusRank` is a single shipped number, so it needs one assumption baked in; real ECR makes the same one. Tiers and Value/Reach still recompute against your actual league at runtime.

`adp` is also shipped as a **rank over the dataset's own players**, not the raw average draft position. The raw field is computed across every player the vendor tracks, so comparing it to a dense `consensusRank` tagged about 92% of the board "Value". Both columns have to be ranks over the same population for their difference to mean anything.

## 7. Known limitations

- **No injury data.** The `Injuries` and `scores/json/Players` endpoints return 401/404 on the free trial, so `Player.note` is never populated. The field still works for hand-written datasets.
- **Half-PPR ADP doesn't exist upstream.** `FantasyPlayers` exposes standard, PPR, dynasty, 2QB and rookie ADP — no half-PPR. Runs currently claim `["ppr"]` only, so the league dialog correctly disables half-PPR. Interpolating between standard and PPR is still open (APE-83).
- **A traded player gets a new id.** Ids embed the team (`name-pos-team`, the documented format), so a trade orphans that player's saved picks. The changelog reports team changes so it's at least visible.
- **Free agents are dropped**, along with anyone whose team has no bye week. `report.json` lists every dropped row and why.
- **Pipeline source must stay within strip-only TypeScript.** The CLI runs `src/lib/data/**` through Node's built-in type stripping, which rejects syntax needing code generation: no parameter properties, enums, namespaces or decorators.
