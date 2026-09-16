import { describe, expect, it } from "vitest";
import { dataset, DEFAULT_LEAGUE } from "@/lib/data";
import { mulberry32 } from "@/lib/draft/sim";
import { buildPlanInput } from "./planInput";
import { buildPlanPrompt } from "./prompt";

// The prototype's scenario: 12 teams, slot 1, full PPR, 16 rounds.
const input = buildPlanInput(DEFAULT_LEAGUE, dataset, { rng: mulberry32(2026) });

describe("buildPlanInput", () => {
  it("has one turn per turn of the prototype's hand-written PLAN", () => {
    expect(input.turns.map((t) => t.picks)).toEqual([[1], [24, 25], [48, 49], [72, 73], [96, 97], [120, 121], [144, 145], [168, 169], [192]]);
  });

  it("gives every turn engine targets, and refs that resolve to unique players", () => {
    for (const turn of input.turns) {
      const ids = turn.candidates.map((c) => c.player.id);
      expect(new Set(ids).size, `picks ${turn.picks}`).toBe(ids.length);
      expect(turn.candidates.some((c) => c.engine === "target"), `picks ${turn.picks}`).toBe(true);
      expect(turn.candidates.length).toBeLessThanOrEqual(12 + 2 + 4 + 3 + 2);
      for (const c of turn.candidates) expect(input.refs.get(c.ref)).toBe(c.player.id);
    }
  });

  it("caps each position, so the late rounds still offer a K and a D/ST", () => {
    for (const turn of input.turns) {
      const reachable = turn.candidates.filter((c) => c.odds >= 0.15 && !c.engine);
      for (const pos of new Set(reachable.map((c) => c.player.pos))) {
        expect(reachable.filter((c) => c.player.pos === pos).length, `${pos} at picks ${turn.picks}`).toBeLessThanOrEqual(4);
      }
    }
    for (const turn of input.turns.slice(-3)) {
      for (const pos of ["K", "DST"]) {
        expect(turn.candidates.some((c) => c.player.pos === pos && c.odds >= 0.15), `${pos} at picks ${turn.picks}`).toBe(true);
      }
    }
  });

  it("gives next-turn odds only where the mocks can tell", () => {
    for (const c of input.turns.at(-1)!.candidates) expect(c.nextOdds).toBeNull();
    const mid = input.turns.slice(1, -1).flatMap((t) => t.candidates);
    expect(mid.filter((c) => c.nextOdds !== null).length).toBeGreaterThan(mid.length / 2);
    // The ADP-buried WRs at picks 24 & 25 mostly survive now, but not the 22 more picks to 48.
    const pickens = input.turns[1].candidates.find((c) => c.player.name === "George Pickens")!;
    expect(pickens.nextOdds).not.toBeNull();
    expect(pickens.nextOdds!).toBeLessThan(pickens.odds);
  });

  it("offers the players the prototype's plan was built around", () => {
    const names = (i: number) => input.turns[i].candidates.map((c) => c.player.name);
    expect(names(0)).toContain("Jahmyr Gibbs");
    // Godwin, the prototype's "biggest discount", is there in round 5.
    expect(names(4)).toContain("Chris Godwin");
  });

  it("follows league shape rather than a fixed 12-team draft", () => {
    const other = buildPlanInput({ ...DEFAULT_LEAGUE, teams: 10, mySlot: 5 }, dataset, { n: 20, rng: mulberry32(1) });
    expect(other.turns[0].picks).toEqual([5]);
    expect(other.turns[1].picks).toEqual([16]);
    expect(other.turns).toHaveLength(DEFAULT_LEAGUE.roster.length);
  });
});

describe("buildPlanPrompt", () => {
  const { system, user } = buildPlanPrompt(input);

  it("describes the league and lists every turn", () => {
    expect(user).toMatch(/^2026 draft: 12 teams, you pick from slot 1, full PPR, 16 rounds\.\nStarters: QB, 2 RB, 2 WR, TE, FLEX \(RB\/WR\/TE\), D\/ST, K\. Bench: 7\./);
    expect(user).toContain("Your picks: 1, 24/25, 48/49, 72/73, 96/97, 120/121, 144/145, 168/169, 192.");
    expect(user).toContain("Return all 9 turns, first picks 1, 24, 48, 72, 96, 120, 144, 168, 192.");
    expect(user).toContain("## pick 1 (round 1, take 1; next pick 24, 22 picks in between)");
    expect(user).toContain("## picks 24 & 25 (round 2/3, take 2; next pick 48, 22 picks in between)");
    expect(user).toContain("## pick 192 (round 16, take 1; your last turn)");
    expect(system).toContain("Use only refs listed under that turn");
    // The sample dataset has no projections, so the prompt doesn't mention them.
    expect(user).not.toContain("proj");
  });

  it("gives a mid-order slot its own rhythm: one pick a turn, shorter waits", () => {
    const mid = buildPlanPrompt(buildPlanInput({ ...DEFAULT_LEAGUE, mySlot: 6 }, dataset, { n: 20, rng: mulberry32(3) })).user;
    expect(mid).toContain("you pick from slot 6");
    expect(mid).toContain("Your picks: 6, 19, 30, 43,");
    expect(mid).toContain("## pick 6 (round 1, take 1; next pick 19, 12 picks in between)");
    expect(mid).toContain("## pick 19 (round 2, take 1; next pick 30, 10 picks in between)");
    expect(mid).not.toContain("take 2");
  });

  it("writes one compact row per candidate", () => {
    const gibbs = input.turns[0].candidates.find((c) => c.player.name === "Jahmyr Gibbs")!;
    expect(user).toContain(`[${gibbs.ref}] Jahmyr Gibbs, RB DET | bye ${gibbs.player.bye} | tier 1 | rank 1 | ESPN 1 (0) | odds 100% | sim: target`);
    // K and D/ST have no ADP-vs-rank gap.
    expect(user).toMatch(/, (K|DST) [A-Z]+ \| bye \d+ \| tier 5 \| rank \d+ \| ESPN \d+ \| odds \d+%/);
  });

  it("stays lean", () => {
    // Roughly 3.5 characters per token: keep a full 16-round prompt under ~7k input tokens.
    expect(system.length + user.length).toBeLessThan(24_000);
  });
});
