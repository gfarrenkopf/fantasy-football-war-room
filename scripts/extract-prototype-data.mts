/**
 * One-off: converts the prototype's inline RAW + BYE data into the app's sample dataset.
 *
 *   node scripts/extract-prototype-data.mts
 *
 * Reads prototype/war_room.html, writes src/lib/data/sample-2026.json.
 * Only needed if the prototype data changes; the JSON is committed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { Dataset, Player, Position } from "../src/lib/draft/types";

const html = readFileSync(new URL("../prototype/war_room.html", import.meta.url), "utf8");

/** Extracts `const NAME = <literal>;` from the prototype script and evaluates the literal in a sandbox. */
function literal<T>(name: string, open: string, close: string): T {
  const start = html.indexOf(`const ${name}`);
  const from = html.indexOf(open, start);
  const to = html.indexOf(`${close};`, from);
  if (start < 0 || from < 0 || to < 0) throw new Error(`Couldn't find ${name} in the prototype`);
  return runInNewContext(`(${html.slice(from, to + close.length)})`) as T;
}

type RawRow = [name: string, pos: Position, team: string, ecr: number, espn: number, tier: number, note?: string];

const byeWeeks = literal<Record<string, number>>("BYE", "{", "}");
const raw = literal<RawRow[]>("RAW", "[", "\n]");

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const players: Player[] = raw.map(([name, pos, team, ecr, espn, , note]) => {
  const bye = byeWeeks[team];
  if (!bye) throw new Error(`No bye week for ${team} (${name})`);
  return {
    id: slug(`${name}-${pos}-${team}`),
    name,
    pos,
    team,
    bye,
    consensusRank: ecr,
    adp: espn,
    posRank: 0,
    ...(note ? { note } : {}),
  };
});

// Position rank by consensus rank, stable on ties (same as the prototype).
for (const pos of new Set(players.map((p) => p.pos))) {
  players
    .filter((p) => p.pos === pos)
    .sort((a, b) => a.consensusRank - b.consensusRank)
    .forEach((p, i) => (p.posRank = i + 1));
}

const ids = new Set(players.map((p) => p.id));
if (ids.size !== players.length) throw new Error("Duplicate player ids");

const dataset: Dataset = {
  season: 2026,
  label: "Sample data: late-Aug 2026 snapshot, may be stale",
  adpSource: "ESPN",
  scoring: ["ppr"],
  byeWeeks,
  players: players.sort((a, b) => a.consensusRank - b.consensusRank || a.adp - b.adp),
};

writeFileSync(new URL("../src/lib/data/sample-2026.json", import.meta.url), `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Wrote ${players.length} players, ${Object.keys(byeWeeks).length} teams.`);
