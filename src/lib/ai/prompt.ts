import { SLOT_DEFS, slotCounts } from "@/lib/draft/league";
import { roundOf } from "@/lib/draft/snake";
import type { ScoringFormat } from "@/lib/draft/types";
import type { PlanCandidate, PlanInput } from "./planInput";

/**
 * The AI plan prompt. Per-generation cost, so it stays lean: a short fixed system prompt and one
 * compact table per turn. Candidates come from buildPlanInput(); the model answers with their refs.
 */

/** Bump when the prompt or the input it's built from changes meaningfully. Recorded with each plan, not used for staleness. */
export const PLAN_PROMPT_VERSION = 1;

export const PLAN_SYSTEM_PROMPT = `You are a fantasy football strategist who has won several league championships, writing a pre-draft game plan for one manager in a snake draft. The goal is to win the league: the roster whose starters score the most points. Write like a sharp, plain-spoken analyst.

For each of the manager's turns you get the candidates a draft simulator considers relevant, with their odds of still being available at this turn and at the manager's next turn.

How to win the draft:
- Timing is the edge, and it depends on the draft slot. Each section says how many picks go by before your next turn: a long wait (up to two rounds at the ends of the order) wipes out more of the board than a short one. Spend a pick on a player who won't last to your next turn over an equally good one who will, and plan to wait on players the platform lets fall (a + gap means the platform drafts him later than experts rank him: a discount). A - gap means the room reaches for him: he won't wait for you.
- When a turn has two picks back to back (slots at either end of the order), think in pairs: the one who won't survive the long wait, plus the best value who might not be there next time either.
- Build the starting lineup first. Depth, handcuffs and upside fliers come after the starters are covered, and K and D/ST go in the last rounds.
- Avoid many likely starters sharing a bye week.
- The simulator's own suggestion (sim) is a baseline, not an answer. Depart from it when the roster or the numbers call for it.

Output rules:
- Answer with refs, the bracketed ids such as p12, not player names. Use only refs listed under that turn.
- You know only what the tables say. Every claim in a note or the intro must come from the columns or a player's note: no outside news, injuries, depth charts or team situations.
- Notes and the intro name players, never refs.
- Return one turn for every section, in order, with its first pick number. Don't stop early: the last turns (K, D/ST, bench) matter too.
- open: before choosing, list the starting slots your earlier take lists haven't filled, e.g. "QB, TE, FLEX, K, D/ST".
- take: exactly as many refs as the section says to take: the players you expect to actually draft. Odds under 50% mean he's more likely gone than there; take him only when the roster truly needs him, and back him up with fallbacks.
- Across all turns, the take lists must fill every starting slot, including K and D/ST, before adding a second QB, TE, K or D/ST.
- targets: 2-4 refs in priority order, the players worth drafting at this turn if they're there, including everyone in take.
- fallbacks: 2-4 refs to draft if the targets are gone.
- letGo: up to 3 refs with odds under 30 that a drafter might still be hoping for: well-ranked names who likely won't last. Leave it empty rather than list players who will be there, or players you planned to draft at an earlier turn.
- Put a ref in at most one of targets, fallbacks and letGo per turn.
- note: 1-3 sentences on why: the gap between ADP and expert rank, odds now versus next turn, roster fit, byes. Don't just restate the lists.
- intro: 2-4 sentences summarizing the plan you actually wrote.`;

const SCORING: Record<ScoringFormat, string> = { ppr: "full PPR", half: "half PPR", std: "standard scoring" };

const pct = (x: number) => Math.round(x * 100);

function rosterLine(input: PlanInput): string {
  const counts = slotCounts(input.league.roster);
  const starters = SLOT_DEFS.filter((d) => d.key !== "BN" && counts[d.key] > 0).map((d) =>
    counts[d.key] > 1 ? `${counts[d.key]} ${d.label}` : d.label,
  );
  return `Starters: ${starters.join(", ")}. Bench: ${counts.BN}.`;
}

const ENGINE = { target: "target", fallback: "fallback", letGo: "let go" } as const;

/** One labeled line per candidate. Labels cost a few tokens but stop the model misreading columns. */
function row(c: PlanCandidate, adpSource: string): string {
  const p = c.player;
  const gap = c.tag.kind === "na" ? "" : ` (${c.tag.delta > 0 ? "+" : ""}${c.tag.delta})`;
  const parts = [
    `[${c.ref}] ${p.name}, ${p.pos} ${p.team}`,
    `bye ${p.bye}`,
    `tier ${c.tier}`,
    ...(p.projPoints === undefined ? [] : [`proj ${Math.round(p.projPoints)} pts`]),
    `rank ${p.consensusRank}`,
    `${adpSource} ${p.adp}${gap}`,
    c.nextOdds === null ? `odds ${pct(c.odds)}%` : `odds ${pct(c.odds)}% now, ${pct(c.nextOdds)}% next turn`,
    `sim: ${c.engine ? ENGINE[c.engine] : "-"}`,
  ];
  return (p.note ? [...parts, p.note] : parts).join(" | ");
}

export function buildPlanPrompt(input: PlanInput): { system: string; user: string } {
  const { league, adpSource } = input;
  const teams = league.teams;
  const firstPicks = input.turns.map((t) => t.picks[0]);
  // Only explain a column that appears: the bundled sample data has no projections.
  const hasProjections = input.turns.some((t) => t.candidates.some((c) => c.player.projPoints !== undefined));
  const lines = [
    `${input.season} draft: ${teams} teams, you pick from slot ${league.mySlot}, ${SCORING[league.scoring]}, ${league.roster.length} rounds.`,
    rosterLine(input),
    "",
    `Each candidate: [ref] name, position team | bye week | tier (1 best, 5 late) | rank = expert rank | ${adpSource} = ${adpSource} ADP (gap: ADP minus rank; + means ${adpSource} drafters let him fall) ${hasProjections ? "| proj = projected season points " : ""}| odds = share of ${input.mocks} mock drafts where he's still there at this turn's first pick, and at your next turn's (left out on the last turn, or when your simulated picks nearly always take him first) | sim = the simulator's own suggestion | note`,
    "",
    `Your picks: ${input.turns.map((t) => t.picks.join("/")).join(", ")}.`,
    `Return all ${input.turns.length} turns, first picks ${firstPicks.join(", ")}.`,
  ];
  input.turns.forEach((turn, i) => {
    const rounds = [...new Set(turn.picks.map((n) => roundOf(n, teams)))].join("/");
    const take = turn.picks.length;
    const next = input.turns[i + 1]?.picks[0];
    const wait = next === undefined ? "your last turn" : `next pick ${next}, ${next - turn.picks.at(-1)! - 1} picks in between`;
    lines.push("", `## pick${take > 1 ? "s" : ""} ${turn.picks.join(" & ")} (round ${rounds}, take ${take}; ${wait})`, ...turn.candidates.map((c) => row(c, adpSource)));
  });
  return { system: PLAN_SYSTEM_PROMPT, user: lines.join("\n") };
}
