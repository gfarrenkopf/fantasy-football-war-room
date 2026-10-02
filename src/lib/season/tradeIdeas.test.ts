import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/draft/types";
import { mulberry32 } from "@/lib/draft/sim/rng";
import { at, player, seasonView } from "@/lib/ai/season/testView";
import { afterTrade, evaluateTrade, seasonLineup, type Trade } from "./trade";
import { BOLD_FLOOR, DEFAULT_LIMITS, findTradeIdeas, ideaStatus, lineupTotal, MIN_GAIN, type TradeCandidate } from "./tradeIdeas";
import type { LineupSlotCount } from "./types";
import type { SeasonView, ViewPlayer, ViewTeam } from "./view";

/**
 * Two teams with opposite holes: the user is deep at RB and thin at WR, the partner the reverse.
 * Swapping the user's third RB for the partner's third WR helps both starting lineups by 6 a week.
 */
function complementary() {
  const myRb = player("My RB3", "RB", 12);
  const theirWr = player("Their WR3", "WR", 12);
  const mine = [player("QB A", "QB", 20), player("RB A", "RB", 18), player("RB B", "RB", 16), myRb, player("RB E", "RB", 10), player("WR A", "WR", 14), player("WR B", "WR", 4), player("TE A", "TE", 8)];
  const theirs = [player("QB B", "QB", 18), player("RB C", "RB", 15), player("RB D", "RB", 3), player("WR C", "WR", 17), player("WR D", "WR", 15), theirWr, player("WR F", "WR", 9), player("TE B", "TE", 7)];
  return { view: seasonView(mine, theirs), myRb, theirWr };
}

const names = (view: SeasonView, c: TradeCandidate) => {
  const all = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
  return { gives: c.trade.gives.map((id) => all.get(id)), gets: c.trade.gets.map((id) => all.get(id)) };
};

describe("lineupTotal", () => {
  it("agrees with the assignment solver, with FLEX and SUPERFLEX, byes and a negative D/ST", () => {
    const superflex: LineupSlotCount[] = [...FULL, { key: "SUPERFLEX", count: 1 }];
    for (let seed = 1; seed <= 30; seed++) {
      const view = randomLeague(seed, { teams: 2, rosterSize: 16, weeks: 4 });
      const rng = mulberry32(seed * 7);
      for (const team of view.teams) {
        // Drop a few players so some slots go short, and sink a D/ST below zero.
        const roster = team.roster.filter(() => rng() > 0.25).map((p) => (p.pos === "DST" ? { ...p, weekly: { ...p.weekly, 6: -3 } } : p));
        for (const starters of [FULL, superflex]) {
          const league = { ...view, starters };
          expect(lineupTotal(roster, league)).toBeCloseTo(seasonLineup(roster, league).total, 6);
        }
      }
    }
  });
});

describe("findTradeIdeas", () => {
  it("finds trades that fill both teams' holes as safe ideas, graded as the trade verdict grades them", () => {
    const { view, myRb, theirWr } = complementary();
    const { safe, stats } = findTradeIdeas(view);
    // The plain swap gains each side 6 a week; the best safe idea does at least that for the user.
    const swap = evaluateTrade(view.teams, view, { teamA: 1, gives: [myRb.playerId], teamB: 2, gets: [theirWr.playerId] })!;
    expect(swap.a.perWeek).toBeCloseTo(6);
    expect(safe[0].you).toBeGreaterThanOrEqual(6);
    for (const idea of safe) {
      const verdict = evaluateTrade(view.teams, view, idea.trade)!;
      expect(idea.you).toBeCloseTo(verdict.a.perWeek);
      expect(idea.them).toBeCloseTo(verdict.b.perWeek);
      expect(idea.them).toBeGreaterThanOrEqual(0);
    }
    expect(stats.truncated).toBe(false);
  });

  it("finds a 2-for-1 consolidation that frees a bench spot for nothing lost", () => {
    // The user's two middling WRs for the partner's one star: the user's lineup gains, and the
    // partner, short of bodies at WR, starts both.
    const star = player("Star WR", "WR", 25);
    const w1 = player("WR mid 1", "WR", 13);
    const w2 = player("WR mid 2", "WR", 12);
    const mine = [player("QB", "QB", 20), player("RB", "RB", 15), player("RB", "RB", 14), w1, w2, player("WR", "WR", 12), player("TE", "TE", 8), player("RB", "RB", 2)];
    const theirs = [player("QB", "QB", 19), player("RB", "RB", 16), player("RB", "RB", 15), star, player("RB", "RB", 13), player("TE", "TE", 9)];
    const view = seasonView(mine, theirs);
    const { safe, bold } = findTradeIdeas(view);
    const all = [...safe, ...bold];
    const consolidation = all.find((c) => c.trade.gets.includes(star.playerId) && c.trade.gives.length === 2);
    expect(consolidation).toBeDefined();
    expect(names(view, consolidation!).gives.sort()).toEqual(["WR mid 1", "WR mid 2"]);
  });

  it("keeps a bold idea only within the partner's limit, and only when it beats the best safe one", () => {
    const { view } = complementary();
    const { safe, bold } = findTradeIdeas(view);
    for (const c of bold) {
      expect(c.them).toBeGreaterThanOrEqual(BOLD_FLOOR);
      expect(c.you).toBeGreaterThan(safe[0]?.you ?? 0);
      expect(safe.some((s) => s.trade.gives.join() === c.trade.gives.join() && s.trade.gets.join() === c.trade.gets.join())).toBe(false);
    }
    for (const c of safe) {
      expect(c.them).toBeGreaterThanOrEqual(0);
      expect(c.you).toBeGreaterThanOrEqual(MIN_GAIN);
    }
  });

  it("allows a partner a small loss on a bold idea and rules out a bigger one", () => {
    // The partner's spare TE starts at FLEX, just ahead of their RB; losing him costs them the gap.
    // The user sends a bench WR they don't need and upgrades at TE by 6 a week.
    const make = (gap: number) => {
      const spare = player("Spare TE", "TE", 10);
      const scrub = player("Bench WR", "WR", 3);
      const mine = [player("QB", "QB", 20), player("RB", "RB", 15), player("RB", "RB", 14), player("WR", "WR", 13), player("WR", "WR", 12), player("TE", "TE", 4), player("RB", "RB", 12), scrub];
      const theirs = [player("QB", "QB", 19), player("RB", "RB", 16), player("RB", "RB", 15), player("WR", "WR", 14), player("WR", "WR", 13), player("TE", "TE", 12), spare, player("RB", "RB", 10 - gap)];
      return { view: seasonView(mine, theirs), spare, scrub };
    };
    const swap = (c: TradeCandidate, m: ReturnType<typeof make>) => c.trade.gives.join() === String(m.scrub.playerId) && c.trade.gets.join() === String(m.spare.playerId);

    const small = make(0.3);
    const smallIdeas = findTradeIdeas(small.view);
    const hit = smallIdeas.bold.find((c) => swap(c, small));
    expect(hit?.them).toBeCloseTo(-0.3);
    expect(hit?.you).toBeCloseTo(6);

    const big = make(0.8);
    const bigIdeas = findTradeIdeas(big.view);
    expect([...bigIdeas.safe, ...bigIdeas.bold].some((c) => swap(c, big))).toBe(false);
  });

  it("leaves out players ESPN won't let move: trade-locked, on IR, already in a pending trade", () => {
    const { view, myRb, theirWr } = complementary();
    const lockedView = { ...view, teams: view.teams.map((t) => ({ ...t, roster: t.roster.map((p) => (p.playerId === theirWr.playerId ? { ...p, tradeLocked: true } : p)) })) };
    expect(mentions(findTradeIdeas(lockedView), theirWr.playerId)).toBe(false);

    const irView = { ...view, teams: view.teams.map((t) => ({ ...t, roster: t.roster.map((p) => (p.playerId === myRb.playerId ? at("IR", p) : p)) })) };
    expect(mentions(findTradeIdeas(irView), myRb.playerId)).toBe(false);

    const pendingView: SeasonView = {
      ...view,
      pendingTrades: [
        {
          id: "t1",
          status: "proposed",
          proposerTeamId: 1,
          partnerTeamId: 2,
          moves: [{ playerId: myRb.playerId, fromTeamId: 1, toTeamId: 2 }],
          proposedAt: null,
          expiresAt: null,
          processesAt: null,
        },
      ],
    };
    expect(mentions(findTradeIdeas(pendingView), myRb.playerId)).toBe(false);
  });

  it("never asks for an unprojected player", () => {
    const { view, theirWr } = complementary();
    const unprojected = { ...view, teams: view.teams.map((t) => ({ ...t, roster: t.roster.map((p) => (p.playerId === theirWr.playerId ? { ...p, ros: 0 } : p)) })) };
    expect(mentions(findTradeIdeas(unprojected), theirWr.playerId)).toBe(false);
  });

  it("finds nothing, without solving a lineup, after the deadline, with no weeks left, or alone in the league", () => {
    const { view } = complementary();
    for (const v of [{ ...view, tradeDeadlinePassed: true }, { ...view, currentWeek: 8 }, { ...view, teams: view.teams.slice(0, 1) }]) {
      const result = findTradeIdeas(v);
      expect(result.safe).toEqual([]);
      expect(result.bold).toEqual([]);
      expect(result.stats.lineups).toBe(0);
    }
  });

  it("finds nothing when no trade helps the user", () => {
    const mine = [player("QB", "QB", 30), player("RB", "RB", 25), player("RB", "RB", 25), player("WR", "WR", 25), player("WR", "WR", 25), player("TE", "TE", 20), player("WR", "WR", 25)];
    const theirs = [player("QB", "QB", 5), player("RB", "RB", 5), player("RB", "RB", 5), player("WR", "WR", 5), player("WR", "WR", 5), player("TE", "TE", 5), player("WR", "WR", 5)];
    const { safe, bold } = findTradeIdeas(seasonView(mine, theirs));
    expect(safe).toEqual([]);
    expect(bold).toEqual([]);
  });

  // Brute force is thousands of exact solves: slow under a loaded test run, so it gets room.
  it("matches a brute-force search on small leagues", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 3; seed++) {
      const view = randomLeague(seed, { teams: 3, rosterSize: 8, weeks: 3 });
      const brute = bruteForce(view);
      const bestSafe = brute.filter((c) => c.you >= MIN_GAIN && c.them >= -1e-9).reduce((m, c) => Math.max(m, c.you), 0);
      // With room for every player, the narrowing only skips players who'd add nothing to the user's
      // lineup, so the best safe trade is found exactly.
      const wide = findTradeIdeas(view, { ...DEFAULT_LIMITS, givePool: 8, perPartner: 8, shortlist: 1_000 });
      expect(wide.safe[0]?.you ?? 0).toBeCloseTo(bestSafe, 9);
      // With the default narrowing it comes within 10% of it.
      const narrow = findTradeIdeas(view);
      expect(narrow.safe[0]?.you ?? 0).toBeGreaterThanOrEqual(0.9 * bestSafe - 1e-9);
    }
  });

  it("stays inside its lineup budget in a 16-team league", () => {
    const view = randomLeague(42, { teams: 16, rosterSize: 16, weeks: 14 });
    const started = performance.now();
    const result = findTradeIdeas(view);
    const ms = performance.now() - started;
    expect(result.stats.lineups).toBeLessThanOrEqual(DEFAULT_LIMITS.maxLineups);
    expect(result.safe.length + result.bold.length).toBeGreaterThan(0);
    // A loose guard against a runaway search; the budget above is the real limit.
    expect(ms).toBeLessThan(2_500);
  });

  it("stops at its budget and keeps the best it found", () => {
    const view = randomLeague(7, { teams: 16, rosterSize: 16, weeks: 14 });
    const result = findTradeIdeas(view, { ...DEFAULT_LIMITS, maxLineups: 100 });
    expect(result.stats.truncated).toBe(true);
    expect(result.stats.lineups).toBeLessThanOrEqual(100);
  });
});

describe("ideaStatus", () => {
  const { view, myRb, theirWr } = complementary();
  const trade: Trade = { teamA: 1, gives: [myRb.playerId], teamB: 2, gets: [theirWr.playerId] };

  it("grades a trade that can still be offered", () => {
    const status = ideaStatus(view, trade);
    expect(status.kind).toBe("ok");
    if (status.kind === "ok") expect(status.verdict.a.perWeek).toBeGreaterThan(0);
  });

  it("calls an idea stale when a player has left that roster", () => {
    const moved = { ...view, teams: view.teams.map((t) => (t.id === 2 ? { ...t, roster: t.roster.filter((p) => p.playerId !== theirWr.playerId) } : t)) };
    expect(ideaStatus(moved, trade)).toEqual({ kind: "stale", missing: [theirWr.playerId] });
  });

  it("calls it blocked when a player is now trade-locked", () => {
    const locked = { ...view, teams: view.teams.map((t) => ({ ...t, roster: t.roster.map((p) => (p.playerId === theirWr.playerId ? { ...p, tradeLocked: true } : p)) })) };
    const status = ideaStatus(locked, trade);
    expect(status.kind).toBe("blocked");
    if (status.kind === "blocked") expect(status.ids).toEqual([theirWr.playerId]);
  });

  it("recognizes it once the user has offered exactly this trade", () => {
    const offered: SeasonView = {
      ...view,
      pendingTrades: [
        {
          id: "p9",
          status: "proposed",
          proposerTeamId: 1,
          partnerTeamId: 2,
          moves: [
            { playerId: myRb.playerId, fromTeamId: 1, toTeamId: 2 },
            { playerId: theirWr.playerId, fromTeamId: 2, toTeamId: 1 },
          ],
          proposedAt: null,
          expiresAt: null,
          processesAt: null,
        },
      ],
    };
    const status = ideaStatus(offered, trade);
    expect(status.kind).toBe("offered");
    if (status.kind === "offered") expect(status.pendingId).toBe("p9");
  });
});

function mentions(search: ReturnType<typeof findTradeIdeas>, playerId: number) {
  return [...search.safe, ...search.bold].some((c) => c.trade.gives.includes(playerId) || c.trade.gets.includes(playerId));
}

const FULL: LineupSlotCount[] = [
  { key: "QB", count: 1 },
  { key: "RB", count: 2 },
  { key: "WR", count: 2 },
  { key: "TE", count: 1 },
  { key: "FLEX", count: 1 },
  { key: "K", count: 1 },
  { key: "DST", count: 1 },
];
const SHAPE: Position[] = ["QB", "QB", "RB", "RB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "WR", "TE", "TE", "K", "DST"];
const SMALL: Position[] = ["QB", "RB", "RB", "RB", "WR", "WR", "WR", "TE"];
const SMALL_STARTERS: LineupSlotCount[] = [
  { key: "QB", count: 1 },
  { key: "RB", count: 2 },
  { key: "WR", count: 2 },
  { key: "TE", count: 1 },
  { key: "FLEX", count: 1 },
];
const BASE: Record<Position, number> = { QB: 18, RB: 11, WR: 11, TE: 8, K: 8, DST: 7 };

/** A seeded league with every team's roster drawn at random around each position's usual output. */
function randomLeague(seed: number, { teams, rosterSize, weeks }: { teams: number; rosterSize: number; weeks: number }): SeasonView {
  const rng = mulberry32(seed);
  const shape = rosterSize === SHAPE.length ? SHAPE : SMALL;
  const starters = rosterSize === SHAPE.length ? FULL : SMALL_STARTERS;
  const first = 5;
  let id = 10_000 * seed;
  const roster = (team: number): ViewPlayer[] =>
    shape.map((pos, i) => {
      const level = BASE[pos] * (0.4 + rng() * 1.2);
      const weekly: Record<number, number> = {};
      for (let w = first; w < first + weeks; w++) weekly[w] = Math.round(rng() < 0.07 ? 0 : level * (0.8 + rng() * 0.4) * 10) / 10;
      const ros = Object.values(weekly).reduce((a, b) => a + b, 0);
      return { ...player(`T${team} ${pos}${i}`, pos, 0), playerId: ++id, weekly, points: weekly[first], ros };
    });
  const view = seasonView(roster(1), roster(2));
  const all: ViewTeam[] = Array.from({ length: teams }, (_, i) => ({
    id: i + 1,
    name: `Team ${i + 1}`,
    abbrev: `T${i + 1}`,
    roster: i < 2 ? view.teams[i].roster : roster(i + 1),
    standing: null,
  }));
  return { ...view, teams: all, starters, benchSize: rosterSize - starters.reduce((n, s) => n + s.count, 0), currentWeek: first, finalWeek: first + weeks - 1 };
}

/**
 * Every 1-for-1 to 2-for-2 with every partner, graded by the assignment solver the verdict uses
 * (`seasonLineup`), each team's before solved once.
 */
function bruteForce(view: SeasonView): { trade: Trade; you: number; them: number }[] {
  const mine = view.teams.find((t) => t.id === view.myTeamId)!;
  const weeks = view.finalWeek - view.currentWeek + 1;
  const subsets = (list: ViewPlayer[]) => [...list.map((p) => [p]), ...list.flatMap((p, i) => list.slice(i + 1).map((q) => [p, q]))];
  const value = (team: ViewTeam, out: ViewPlayer[], incoming: ViewPlayer[]) => seasonLineup(afterTrade(team.roster, new Set(out.map((p) => p.playerId)), incoming, view).roster, view).total;
  const myBase = seasonLineup(mine.roster, view).total;
  const out: { trade: Trade; you: number; them: number }[] = [];
  for (const partner of view.teams.filter((t) => t.id !== mine.id)) {
    const base = seasonLineup(partner.roster, view).total;
    for (const gives of subsets(mine.roster)) {
      for (const gets of subsets(partner.roster)) {
        const trade = { teamA: mine.id, gives: gives.map((p) => p.playerId), teamB: partner.id, gets: gets.map((p) => p.playerId) };
        out.push({ trade, you: (value(mine, gives, gets) - myBase) / weeks, them: (value(partner, gets, gives) - base) / weeks });
      }
    }
  }
  return out;
}
