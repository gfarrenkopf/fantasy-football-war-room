/**
 * Ingestion CLI. Run it through npm so the env file and resolve hook are wired up:
 *
 *   npm run ingest -- --dry-run        fetch, normalize, QA, print the changelog; publish nothing
 *   npm run ingest                     the same, but publish when QA passes
 *   npm run ingest -- --from <run-id>  re-normalize a stored snapshot without re-fetching
 *   npm run ingest -- --rollback       republish the previous snapshot
 *   npm run ingest -- --list           list stored snapshots
 *
 * While the key is on the free trial, --dry-run is the mode to use: the data does not
 * pass QA, and it shouldn't.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@/lib/data/sportsdata/client";
import type { SdSnapshot } from "@/lib/data/sportsdata/types";
import { diffDatasets, formatChangelog } from "@/lib/data/pipeline/changelog";
import { normalize } from "@/lib/data/pipeline/normalize";
import { formatQa, runQa } from "@/lib/data/pipeline/qa";
import { checkTiers, topBoard } from "@/lib/data/pipeline/tierCheck";
import {
  listSnapshots,
  newRunId,
  publish,
  readLive,
  rollback,
  SNAPSHOTS_DIR,
  writeSnapshot,
  type RunReport,
} from "@/lib/data/pipeline/snapshot";
import { requireApiKey } from "./env.mjs";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const SEASON = Number(valueOf("--season") ?? 2026);

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (has("--list")) {
  const snapshots = listSnapshots();
  console.log(snapshots.length ? snapshots.join("\n") : "no snapshots yet");
  process.exit(0);
}

if (has("--rollback")) {
  try {
    const now = rollback(valueOf("--rollback")?.startsWith("--") ? undefined : valueOf("--rollback"));
    console.log(`✓ rolled back — ${now} is now live`);
    console.log("  run `npm run build` to pick it up");
  } catch (err) {
    fail((err as Error).message);
  }
  process.exit(0);
}

const dryRun = has("--dry-run");
const fromSnapshot = valueOf("--from");
const runId = newRunId();

// --- fetch (or reload a stored snapshot) ---------------------------------------------

let snapshot: SdSnapshot;
if (fromSnapshot) {
  const raw = join(SNAPSHOTS_DIR, fromSnapshot, "raw");
  const load = <T,>(name: string): T => JSON.parse(readFileSync(join(raw, `${name}.json`), "utf8")) as T;
  try {
    snapshot = {
      fantasyPlayers: load("fantasy-players"),
      projections: load("projections"),
      byes: load("byes"),
    };
  } catch (err) {
    fail(`couldn't read snapshot "${fromSnapshot}": ${(err as Error).message}`);
  }
  console.log(`re-normalizing stored snapshot ${fromSnapshot} (no API calls)`);
} else {
  const client = createClient({ apiKey: requireApiKey(), season: SEASON });
  console.log(`fetching season ${SEASON} from SportsDataIO…`);
  try {
    snapshot = await client.snapshot();
  } catch (err) {
    fail((err as Error).message);
  }
}

const sources = {
  fantasyPlayers: snapshot.fantasyPlayers.length,
  projections: snapshot.projections.length,
  byes: snapshot.byes.length,
};
console.log(`  ${Object.entries(sources).map(([k, n]) => `${k}: ${n}`).join(", ")}`);

// --- normalize -----------------------------------------------------------------------

const { dataset, dropped } = normalize(snapshot, {
  season: SEASON,
  label: `SportsDataIO ${SEASON}, run ${runId}`,
  adpSource: "SportsDataIO",
  scoring: ["ppr"],
});
console.log(`\nnormalized ${dataset.players.length} players (${dropped.length} dropped)`);

// --- QA + tier validation ------------------------------------------------------------

const qa = runQa(dataset);
const tiers = checkTiers(dataset);

console.log(`\n${formatQa(qa)}`);
if (tiers.findings.length) console.log(tiers.findings.map((f) => `${f.severity === "failure" ? "FAIL" : "WARN"} [${f.check}] ${f.message}`).join("\n"));

console.log("\ntop of the board:");
console.log(topBoard(dataset, 15).map((l) => `  ${l}`).join("\n"));

for (const s of tiers.presets) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.log(`  ${s.preset}: tiers ${s.tierCounts.join("/")} — value ${pct(s.tagShares.value)}, reach ${pct(s.tagShares.reach)}, even ${pct(s.tagShares.even)}`);
}

// --- changelog -----------------------------------------------------------------------

const live = readLive();
const changelog = live ? diffDatasets(live, dataset) : null;
if (changelog) {
  console.log(`\nchanges since the live dataset:\n${formatChangelog(changelog)}`);
} else {
  console.log("\nno live dataset yet — nothing to diff against");
}

// --- write the snapshot, publish only if everything passed ----------------------------

const blocked = !qa.ok ? "QA failures" : !tiers.ok ? "tier/value failures" : dryRun ? "--dry-run" : undefined;

const report: RunReport = {
  runId,
  startedAt: new Date().toISOString(),
  season: SEASON,
  sources,
  dropped,
  qa,
  tiers,
  changelog,
  published: !blocked,
  ...(blocked ? { blockedBy: blocked } : {}),
};

const dir = writeSnapshot({
  runId,
  dataset,
  report,
  raw: fromSnapshot
    ? {}
    : { "fantasy-players": snapshot.fantasyPlayers, projections: snapshot.projections, byes: snapshot.byes },
});
console.log(`\nsnapshot written to ${dir}`);

if (blocked) {
  console.error(`\n✗ not published (${blocked}). live.json is unchanged.`);
  process.exit(blocked === "--dry-run" ? 0 : 1);
}

publish(runId);
console.log(`\n✓ published — ${runId} is now live`);
console.log("  run `npm run build` to pick it up");
