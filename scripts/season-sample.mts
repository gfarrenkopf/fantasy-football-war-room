/**
 * Builds the in-season landing page's sample week (APE-340) from ESPN's public player data.
 *
 *   npm run season-sample [-- --season 2026 --week 5]
 *
 * Writes src/lib/data/season-sample-<season>.json. Run it once at the start of each season (or
 * whenever the sample's players look stale), review the file, and commit it: the landing page never
 * fetches anything. The players and their projections are ESPN's; the team names, win chances,
 * final score and trade gains are picked here by hand, because the page is marketing, not a feed.
 *
 * Uses the same unofficial endpoints as the season features (docs/espn-protocol.md); no ESPN login.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Position } from "@/lib/draft/types";
import { mulberry32 } from "@/lib/draft/sim/rng";
import { ESPN_POSITIONS, PRO_TEAMS } from "@/lib/espn/proTeams";
import { validateSeasonSample, type SamplePlayer, type SampleSlot, type SeasonSample } from "@/lib/landing/seasonSample";

const API = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

const { values } = parseArgs({ options: { season: { type: "string" }, week: { type: "string" } } });

async function get(url: string, filter?: object): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json", ...(filter ? { "X-Fantasy-Filter": JSON.stringify(filter) } : {}) } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- season and week

const status = (await get(`${API}/${values.season ?? new Date().getFullYear()}`)) as Obj;
const season = Number(values.season ?? status.id);
const week = Number(values.week ?? (isObj(status.currentScoringPeriod) ? status.currentScoringPeriod.id : NaN));
if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) throw new Error("Couldn't tell the season and week; pass --season and --week");

// ---------------------------------------------------------------- the NFL schedule: this week's games and the season window

/** ESPN's fantasy default: the championship is week 17. */
const FANTASY_FINAL_WEEK = 17;
const schedule = (await get(`${API}/${season}?view=proTeamSchedules_wl`)) as Obj;
const proTeams = isObj(schedule.settings) && Array.isArray(schedule.settings.proTeams) ? schedule.settings.proTeams.filter(isObj) : [];
const gameThisWeek = new Map<string, string>();
let firstKickoff = Infinity;
let lastFinalGame = 0;
for (const t of proTeams) {
  const team = PRO_TEAMS[Number(t.id)];
  const byWeek = isObj(t.proGamesByScoringPeriod) ? t.proGamesByScoringPeriod : {};
  for (const [w, games] of Object.entries(byWeek)) {
    for (const g of Array.isArray(games) ? games.filter(isObj) : []) {
      const date = Number(g.date);
      if (Number(w) === 1) firstKickoff = Math.min(firstKickoff, date);
      if (Number(w) === FANTASY_FINAL_WEEK) lastFinalGame = Math.max(lastFinalGame, date);
      if (Number(w) === week && team) {
        const home = Number(g.homeProTeamId) === Number(t.id);
        gameThisWeek.set(team, `${home ? "vs" : "@"} ${PRO_TEAMS[Number(home ? g.awayProTeamId : g.homeProTeamId)]}`);
      }
    }
  }
}
if (!Number.isFinite(firstKickoff) || !lastFinalGame) throw new Error("Couldn't read the season's schedule");
/** Through the Wednesday after the fantasy final, when the season page's recap of it is done. */
const windowEnd = lastFinalGame + 3 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- the player pool

interface Pooled extends SamplePlayer {
  id: number;
  /** ESPN's season projection, the stand-in for where a manager ranks him. */
  seasonProj: number;
  /** Rank at his position by season projection. */
  posRank: number;
  owned: number;
  injured: boolean;
}

const raw = (await get(`${API}/${season}/segments/0/leaguedefaults/3?view=kona_player_info&scoringPeriodId=${week}`, {
  players: { limit: 500, sortPercOwned: { sortPriority: 1, sortAsc: false } },
})) as Obj;

const pool: Pooled[] = [];
for (const row of Array.isArray(raw.players) ? raw.players.filter(isObj) : []) {
  const p = isObj(row.player) ? row.player : null;
  const pos = p ? ESPN_POSITIONS[Number(p.defaultPositionId)] : undefined;
  if (!p || !pos) continue;
  const stats = Array.isArray(p.stats) ? p.stats.filter(isObj) : [];
  const projected = (split: number, period: number) =>
    stats.find((s) => s.seasonId === season && s.statSourceId === 1 && s.statSplitTypeId === split && s.scoringPeriodId === period)?.appliedTotal;
  const proj = Number(projected(1, week));
  const seasonProj = Number(projected(0, 0));
  const team = PRO_TEAMS[Number(p.proTeamId)];
  const game = team ? gameThisWeek.get(team) : undefined;
  // On a bye, or without projections: not a player the sample can use this week.
  if (!team || !game || !(proj > 0.5) || !(seasonProj > 0)) continue;
  pool.push({
    id: Number(p.id),
    name: pos === "DST" ? `${team} D/ST` : String(p.fullName),
    pos,
    team,
    game,
    proj: round1(proj),
    seasonProj,
    posRank: 0,
    owned: Number(isObj(p.ownership) ? p.ownership.percentOwned : 0),
    injured: p.injuryStatus !== undefined && p.injuryStatus !== "ACTIVE",
  });
}
const byPos = new Map<Position, Pooled[]>();
for (const p of pool) byPos.set(p.pos, [...(byPos.get(p.pos) ?? []), p]);
for (const list of byPos.values()) {
  list.sort((a, b) => b.seasonProj - a.seasonProj);
  list.forEach((p, i) => (p.posRank = i + 1));
}
const at = (pos: Position, rank: number) => byPos.get(pos)?.find((p) => p.posRank >= rank && !p.injured);

// ---------------------------------------------------------------- the team, built around one swap

/**
 * The swap is the page's whole story: a starter by rank (a top-24 back or receiver) whom ESPN
 * projects poorly this week, and a lower-ranked bench player at the same position it projects well.
 * Every other player is chosen so that's the only change the projections make.
 */
const SLOTS: { slot: string; fits: Position[] }[] = [
  { slot: "QB", fits: ["QB"] },
  { slot: "RB", fits: ["RB"] },
  { slot: "RB", fits: ["RB"] },
  { slot: "WR", fits: ["WR"] },
  { slot: "WR", fits: ["WR"] },
  { slot: "TE", fits: ["TE"] },
  { slot: "FLEX", fits: ["RB", "WR", "TE"] },
  { slot: "D/ST", fits: ["DST"] },
  { slot: "K", fits: ["K"] },
];

/** Fills the slots in order with the best player by `key`: the lineup a manager sets by rank, or by this week's projection. */
function setLineup(roster: Pooled[], key: (p: Pooled) => number): Pooled[] {
  const left = [...roster].sort((a, b) => key(b) - key(a));
  return SLOTS.map(({ fits }) => {
    const i = left.findIndex((p) => fits.includes(p.pos));
    if (i < 0) throw new Error("roster can't fill the lineup");
    return left.splice(i, 1)[0];
  });
}

interface Pair {
  out: Pooled;
  in: Pooled;
  /** Points this week the swap gains. */
  gap: number;
}

/** Fills the rest of the roster around the swaps: starters by rank above them, backups that project below them. */
function buildTeam(pairs: Pair[]): Pooled[] | null {
  const hasOut = (pos: Position) => pairs.some((p) => p.out.pos === pos);
  const rbs = hasOut("RB") ? [at("RB", 4)] : [at("RB", 4), at("RB", 12)];
  const wrs = hasOut("WR") ? [at("WR", 5)] : [at("WR", 5), at("WR", 14)];
  const picks = [
    at("QB", 7),
    ...rbs,
    ...wrs,
    ...pairs.flatMap((p) => [p.out, p.in]),
    at("TE", 6),
    at(hasOut("WR") && !hasOut("RB") ? "RB" : "WR", 20),
    at("DST", 6),
    at("K", 5),
    at("QB", 18),
    at("RB", 46),
    at("WR", 60),
    at("TE", 22),
  ];
  if (picks.some((p) => !p)) return null;
  const roster = (picks as Pooled[]).slice(0, 15);
  if (new Set(roster.map((p) => p.id)).size !== roster.length) return null;
  const byRank = setLineup(roster, (p) => p.seasonProj);
  const best = setLineup(roster, (p) => p.proj);
  const changed = byRank.flatMap((p, i) => (p.id === best[i].id ? [] : [i]));
  if (changed.length !== pairs.length) return null;
  return pairs.every((pair) => changed.some((i) => byRank[i].id === pair.out.id && best[i].id === pair.in.id)) ? roster : null;
}

/** The best week-swing pairs at a position: a top-30 starter by rank, and a bench player ranked well below him who projects higher. */
function pairsAt(pos: Position): Pair[] {
  const list = byPos.get(pos) ?? [];
  const outs = list.filter((p) => p.posRank >= 10 && p.posRank <= 30 && !p.injured);
  const ins = list.filter((p) => p.posRank >= 28 && p.posRank <= 60 && !p.injured);
  return outs
    .flatMap((o) => ins.filter((i) => i.posRank > o.posRank + 6).map((i) => ({ out: o, in: i, gap: i.proj - o.proj })))
    .filter((pair) => pair.gap >= 1.5)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 12);
}

/** Two swaps, one at running back and one at receiver, when the week has them; otherwise the biggest single one. */
let team: { roster: Pooled[]; pairs: Pair[] } | null = null;
const rbPairs = pairsAt("RB");
const wrPairs = pairsAt("WR");
search: for (const rb of rbPairs) {
  for (const wr of wrPairs) {
    const roster = buildTeam([rb, wr]);
    if (roster) {
      team = { roster, pairs: [rb, wr] };
      break search;
    }
  }
}
if (!team) {
  for (const pair of [...rbPairs, ...wrPairs].sort((a, b) => b.gap - a.gap)) {
    const roster = buildTeam([pair]);
    if (roster) {
      team = { roster, pairs: [pair] };
      break;
    }
  }
}
if (!team) throw new Error("No week-swing pair builds a clean team this week; try another --week");

const strip = ({ name, pos, team: t, game, proj }: Pooled): SamplePlayer => ({ name, pos, team: t, game, proj });
const { roster, pairs: swapPairs } = team;
const byRank = setLineup(roster, (p) => p.seasonProj);
const lineup: SampleSlot[] = byRank.map((p, i) => ({ slot: SLOTS[i].slot, player: strip(p) }));
/** What the swapped players scored, picked by hand: the first call a blowout, the second a clear win, both enough to decide the week. */
const SCORED = [
  { in: 9.1, out: -4.3 },
  { in: 4.6, out: -3.1 },
];
const swaps = swapPairs.map((pair, i) => ({
  slot: byRank.findIndex((p) => p.id === pair.out.id),
  out: strip(pair.out),
  in: strip(pair.in),
  points: { in: round1(pair.in.proj + SCORED[i].in), out: round1(pair.out.proj + SCORED[i].out) },
}));
const bench = roster.filter((p) => !byRank.includes(p)).sort((a, b) => b.proj - a.proj);
const rankTotal = round1(byRank.reduce((sum, p) => sum + p.proj, 0));
const gain = round1(swapPairs.reduce((sum, p) => sum + p.in.proj - p.out.proj, 0));
const starSwap = [...swaps].sort((a, b) => b.points.in - a.points.in)[0];

// ---------------------------------------------------------------- the rest, picked by hand

const taken = new Set(roster.map((p) => p.id));
const free = (p: Pooled) => !taken.has(p.id) && !p.injured;

/**
 * A trade that helps both sides: the backup quarterback who sits on your bench all season, for a
 * receiver who starts for you every week and a back for your bench. Two for one in your favor, on
 * purpose: on a landing page, more coming back reads as the better side.
 */
const tradeSend = [bench.find((p) => p.pos === "QB")];
const getWr = (byPos.get("WR") ?? []).find((p) => free(p) && p.posRank >= 14 && p.posRank <= 24);
/** The back comes to back up: he projects below every back in Draft Room's lineup this week. */
const startingRbs = byRank.map((p) => swapPairs.find((s) => s.out.id === p.id)?.in ?? p).filter((p) => p.pos === "RB");
const rbFloor = Math.min(...startingRbs.map((p) => p.proj));
const getRb = (byPos.get("RB") ?? []).find((p) => free(p) && p.posRank >= 20 && p.posRank <= 30 && p.proj < rbFloor);
if (tradeSend.some((p) => !p) || !getWr || !getRb) throw new Error("Couldn't build the sample trade");
const tradeGet = [getWr, getRb];
for (const p of tradeGet) taken.add(p.id);

/** The pickup: the best-projected player most leagues have left on the wire. */
const add = pool.filter((p) => free(p) && p.owned < 45 && ["RB", "WR", "TE"].includes(p.pos)).sort((a, b) => b.proj - a.proj)[0];
const drop = bench.filter((p) => !tradeSend.includes(p)).sort((a, b) => a.seasonProj - b.seasonProj)[0];

const TEAMS = [
  "Hurts So Good",
  "Tua Legit to Quit",
  "Kelce Grammer",
  "Bijan Mustard",
  "Ja'Marr the Merrier",
  "Saquon Me Later",
  "Nacho Average Team",
  "Lamar Your Business",
  "Waddle Waddle",
  "Gibbs Me a Break",
];
const rng = mulberry32(season * 100 + week);
const score = () => round1(88 + rng() * 52);
const scoreboard = Array.from({ length: TEAMS.length / 2 }, (_, i) => ({
  home: TEAMS[i * 2],
  away: TEAMS[i * 2 + 1],
  homeScore: score(),
  awayScore: score(),
}));

/** The opponent projects just ahead of the lineup by rank, so the swap flips the matchup. */
const opponentProj = round1(rankTotal + Math.min(2.4, gain / 2));
const sample: SeasonSample = {
  season,
  window: { start: new Date(firstKickoff).toISOString(), end: new Date(windowEnd).toISOString() },
  you: "Your team",
  opponent: "The Commish",
  lineup,
  bench: bench.map(strip),
  swaps,
  opponentProj,
  winChance: { before: 0.46, after: 0.71 },
  final: { you: round1(rankTotal + gain + 9.6), opponent: round1(opponentProj - 3.2) },
  star: { name: starSwap.in.name, points: starSwap.points.in },
  trade: {
    partner: "Kelce Grammer",
    send: (tradeSend as Pooled[]).map(strip),
    get: tradeGet.map(strip),
    gain: { you: 2.3, partner: 1.1 },
    why: `They need a quarterback and you have two. ${tradeSend[0]!.name} sits on your bench every week; ${getWr.name} starts for you, and ${getRb.name} backs up your running backs.`,
  },
  waiver: { add: strip(add), drop: strip(drop), gain: round1(add.proj - drop.proj), owned: Math.round(add.owned) },
  scoreboard,
};

validateSeasonSample(sample);
const out = new URL(`../src/lib/data/season-sample-${season}.json`, import.meta.url);
writeFileSync(out, `${JSON.stringify(sample, null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(out)}`);
for (const p of swapPairs) console.log(`Week ${week}: ${p.out.name} (${p.out.proj}) → ${p.in.name} (${p.in.proj})`);
console.log(`+${gain}. Rank lineup ${rankTotal} vs ${opponentProj}.`);
