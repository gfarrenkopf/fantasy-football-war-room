/**
 * Captures test fixtures from the live SportsDataIO API (2.0).
 *
 *   npm run capture-fixtures
 *
 * Writes src/lib/data/__fixtures__/*.json — trimmed, redacted copies of real responses,
 * so the whole pipeline is testable offline, in CI, and with no API key.
 *
 * Trimmed because the full responses are ~2.5 MB and most of it is defensive-player rows
 * the pipeline never reads. We keep every drafted skill player plus all kickers and
 * defenses, which is enough to exercise every code path including the positions that
 * usually break (D/ST, and players with no projection).
 *
 * Only re-run this when the upstream response shape changes. The fixtures are committed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@/lib/data/sportsdata/client";
import type { SdFantasyPlayer, SdSeasonProjection } from "@/lib/data/sportsdata/types";
import { requireApiKey } from "./env.mjs";

const SEASON = Number(process.argv.find((a) => /^\d{4}$/.test(a)) ?? 2026);
const OUT = join("src", "lib", "data", "__fixtures__");
const KEEP_PER_POSITION = 60;

/**
 * Fields that could identify the account or the key. None are read by the pipeline, and
 * fixtures are committed to a public repo, so they're stripped rather than trusted.
 */
const REDACT = new Set(["FantasyPlayerKey", "GlobalTeamID", "PlayerSeasonID"]);

const redact = <T extends object>(row: T): T =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !REDACT.has(k))) as T;

/**
 * Season projection rows carry 130+ stat fields each, which is a megabyte of committed
 * JSON for data the pipeline never reads. Keep the fields normalization uses plus a few
 * neighbours, so an upstream rename still shows up in a fixture refresh.
 */
const PROJECTION_FIELDS = [
  "PlayerID",
  "Name",
  "Team",
  "Position",
  "FantasyPosition",
  "Season",
  "SeasonType",
  "FantasyPoints",
  "FantasyPointsPPR",
  "AverageDraftPosition",
  "AverageDraftPositionPPR",
];

const slim = <T extends object>(row: T): Partial<T> =>
  Object.fromEntries(PROJECTION_FIELDS.filter((k) => k in row).map((k) => [k, (row as Record<string, unknown>)[k]])) as Partial<T>;

const client = createClient({ apiKey: requireApiKey(), season: SEASON });
console.log(`fetching season ${SEASON}…`);
const snapshot = await client.snapshot();

// Keep the top N per position by PPR ADP, plus every K and DEF.
const byPosition = new Map<string, SdFantasyPlayer[]>();
for (const row of snapshot.fantasyPlayers) {
  if (!row.Team || row.Team === "FA") continue;
  byPosition.set(row.Position, [...(byPosition.get(row.Position) ?? []), row]);
}

const keptPlayers: SdFantasyPlayer[] = [];
for (const [position, rows] of byPosition) {
  const sorted = rows.slice().sort((a, b) => (a.AverageDraftPositionPPR ?? 9999) - (b.AverageDraftPositionPPR ?? 9999));
  keptPlayers.push(...(position === "K" || position === "DEF" ? sorted : sorted.slice(0, KEEP_PER_POSITION)));
}

const keptIds = new Set(keptPlayers.map((p) => p.PlayerID));
const keptProjections: SdSeasonProjection[] = snapshot.projections.filter((p) => keptIds.has(p.PlayerID));

mkdirSync(OUT, { recursive: true });
const write = (name: string, value: unknown) => {
  const path = join(OUT, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`  ${path} (${Array.isArray(value) ? value.length : "?"} rows)`);
};

write("fantasy-players", keptPlayers.map(redact));
write("projections", keptProjections.map((row) => slim(redact(row))));
write("byes", snapshot.byes.map(redact));

console.log(`\n✓ fixtures captured for season ${SEASON}`);
console.log("  these are trial-tier responses: they prove response shape, never data correctness");
