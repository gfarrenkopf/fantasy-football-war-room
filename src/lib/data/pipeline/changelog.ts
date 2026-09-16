import type { Dataset, Player } from "@/lib/draft/types";

/**
 * Diffs a candidate dataset against the currently published one (2.4).
 *
 * The point is that no refresh silently replaces the board mid-season. Team changes get
 * their own section because they're the destructive case: player ids embed the team, so a
 * traded player gets a new id and any saved draft that included him is left with a hole.
 */

export interface PlayerMove {
  id: string;
  name: string;
  from: number;
  to: number;
  delta: number;
}

export interface TeamChange {
  name: string;
  fromId: string;
  toId: string;
  fromTeam: string;
  toTeam: string;
}

export interface Changelog {
  added: { id: string; name: string; pos: string; adp: number }[];
  dropped: { id: string; name: string; pos: string }[];
  adpMoves: PlayerMove[];
  rankMoves: PlayerMove[];
  teamChanges: TeamChange[];
  byeChanges: { team: string; from: number; to: number }[];
  counts: { before: number; after: number };
}

export interface DiffOptions {
  /** Report ADP moves of at least this many spots. */
  adpThreshold?: number;
  /** Report consensusRank moves of at least this many spots. */
  rankThreshold?: number;
}

/** Identity that survives a trade, so a moved player reads as moved rather than added+dropped. */
const identity = (p: Player) => `${p.name}|${p.pos}`;

export function diffDatasets(before: Dataset, after: Dataset, options: DiffOptions = {}): Changelog {
  const { adpThreshold = 10, rankThreshold = 10 } = options;

  const beforeById = new Map(before.players.map((p) => [p.id, p]));
  const afterById = new Map(after.players.map((p) => [p.id, p]));
  const beforeByIdentity = new Map(before.players.map((p) => [identity(p), p]));
  const afterByIdentity = new Map(after.players.map((p) => [identity(p), p]));

  const teamChanges: TeamChange[] = [];
  for (const p of after.players) {
    if (beforeById.has(p.id)) continue;
    const prior = beforeByIdentity.get(identity(p));
    if (prior && prior.team !== p.team) {
      teamChanges.push({ name: p.name, fromId: prior.id, toId: p.id, fromTeam: prior.team, toTeam: p.team });
    }
  }
  const movedFrom = new Set(teamChanges.map((t) => t.fromId));
  const movedTo = new Set(teamChanges.map((t) => t.toId));

  const added = after.players
    .filter((p) => !beforeById.has(p.id) && !movedTo.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, pos: p.pos, adp: p.adp }));

  const dropped = before.players
    .filter((p) => !afterById.has(p.id) && !movedFrom.has(p.id) && !afterByIdentity.has(identity(p)))
    .map((p) => ({ id: p.id, name: p.name, pos: p.pos }));

  const adpMoves: PlayerMove[] = [];
  const rankMoves: PlayerMove[] = [];
  for (const p of after.players) {
    const prior = beforeById.get(p.id);
    if (!prior) continue;
    const adpDelta = p.adp - prior.adp;
    if (Math.abs(adpDelta) >= adpThreshold) {
      adpMoves.push({ id: p.id, name: p.name, from: prior.adp, to: p.adp, delta: adpDelta });
    }
    const rankDelta = p.consensusRank - prior.consensusRank;
    if (Math.abs(rankDelta) >= rankThreshold) {
      rankMoves.push({ id: p.id, name: p.name, from: prior.consensusRank, to: p.consensusRank, delta: rankDelta });
    }
  }
  adpMoves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  rankMoves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const byeChanges = Object.entries(after.byeWeeks)
    .filter(([team, week]) => before.byeWeeks[team] !== undefined && before.byeWeeks[team] !== week)
    .map(([team, week]) => ({ team, from: before.byeWeeks[team], to: week }));

  return {
    added,
    dropped,
    adpMoves,
    rankMoves,
    teamChanges,
    byeChanges,
    counts: { before: before.players.length, after: after.players.length },
  };
}

export function formatChangelog(log: Changelog): string {
  const lines: string[] = [`players: ${log.counts.before} → ${log.counts.after}`];
  const section = (label: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`\n${label} (${items.length}):`);
    lines.push(...items.slice(0, 20).map((s) => `  ${s}`));
    if (items.length > 20) lines.push(`  …and ${items.length - 20} more`);
  };

  section(
    "team changes — these orphan saved picks",
    log.teamChanges.map((t) => `${t.name}: ${t.fromTeam} → ${t.toTeam} (${t.fromId} → ${t.toId})`),
  );
  section("added", log.added.map((p) => `${p.name} (${p.pos}) adp=${p.adp}`));
  section("dropped", log.dropped.map((p) => `${p.name} (${p.pos})`));
  section("ADP moves", log.adpMoves.map((m) => `${m.name}: ${m.from} → ${m.to} (${m.delta > 0 ? "+" : ""}${m.delta.toFixed(1)})`));
  section("rank moves", log.rankMoves.map((m) => `${m.name}: ${m.from} → ${m.to} (${m.delta > 0 ? "+" : ""}${m.delta})`));
  section("bye changes", log.byeChanges.map((b) => `${b.team}: week ${b.from} → ${b.to}`));

  return lines.join("\n");
}
