import { FALLBACK_ODDS } from "@/lib/draft/sim";
import { slotCounts } from "@/lib/draft/league";
import { LATE_POSITIONS, POSITIONS, type Player, type Position } from "@/lib/draft/types";
import type { JsonSchema } from "./provider";
import type { PlanCandidate, PlanInput } from "./planInput";

/** One turn of a validated AI plan. Player ids, never refs. */
export interface AiPlanTurn {
  picks: number[];
  note: string;
  /** Who the plan expects the user to draft at this turn, at most one per pick. Together: the model roster. */
  take: string[];
  targets: string[];
  fallbacks: string[];
  letGo: string[];
}

/** A validated AI plan: the prototype's hand-written PLAN, written by a model for any league. */
export interface AiPlan {
  intro: string;
  turns: AiPlanTurn[];
}

const refList = { type: "array", items: { type: "string", description: "A candidate ref such as p12." } };

/** The response shape the model is asked for. Only features every structured-output provider supports. */
export const PLAN_OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intro", "turns"],
  properties: {
    intro: { type: "string" },
    turns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pick", "open", "note", "take", "targets", "fallbacks", "letGo"],
        properties: {
          pick: { type: "integer", description: "The turn's first pick number." },
          // Not kept: making the model write down the open slots first keeps its roster count straight.
          open: { type: "string", description: "Starting slots still unfilled before this turn." },
          note: { type: "string" },
          take: refList,
          targets: refList,
          fallbacks: refList,
          letGo: refList,
        },
      },
    },
  },
};

export const LIMITS = { targets: 4, fallbacks: 4, letGo: 3, note: 600, intro: 1200 };

export type PlanValidation = { ok: true; plan: AiPlan; issues: string[] } | { ok: false; issues: string[] };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
const nameKey = (name: string) => `name:${name.trim().toLowerCase()}`;
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);

/**
 * Checks a model response against the input it was generated from. Never trusts the model:
 * refs not offered for that turn, repeats, overlong lists, let-go players who will likely be there
 * (or were planned earlier), and a second pick of the same player are dropped and reported; a
 * short take list is filled from the targets. A turn left with no valid target is dropped so the
 * caller can fall back for that turn alone.
 * Fails only when the response isn't the expected shape or no turn survives.
 */
export function validateAiPlan(raw: unknown, input: PlanInput): PlanValidation {
  if (!isObject(raw) || !Array.isArray(raw.turns)) return { ok: false, issues: ["response is not a plan object"] };
  const issues: string[] = [];

  const byPick = new Map<number, Record<string, unknown>>();
  for (const t of raw.turns) {
    if (isObject(t) && typeof t.pick === "number" && !byPick.has(t.pick)) byPick.set(t.pick, t);
  }

  const turns: AiPlanTurn[] = [];
  /** Players an earlier turn drafted or targeted. */
  const takenEarlier = new Set<string>();
  const targetedEarlier = new Set<string>();
  for (const { picks, candidates } of input.turns) {
    const label = `picks ${picks.join(" & ")}`;
    const answer = byPick.get(picks[0]);
    if (!answer) {
      issues.push(`${label}: missing`);
      continue;
    }
    // Refs are what the model is asked for, but an exact name of an offered player is just as grounded.
    const offered = new Map(candidates.flatMap((c) => [[c.ref, c] as const, [nameKey(c.player.name), c] as const]));
    const refsIn = (key: string, accept: (c: PlanCandidate, r: string) => boolean, max: number) => {
      const out: PlanCandidate[] = [];
      for (const r of strings(answer[key])) {
        const c = offered.get(r.trim().replace(/^\[(.*)\]$/, "$1")) ?? offered.get(nameKey(r));
        if (!c) issues.push(`${label}: ${key} cites ${r}, which wasn't offered`);
        else if (out.includes(c)) issues.push(`${label}: ${key} repeats ${r}`);
        else if (out.length >= max) issues.push(`${label}: ${key} over ${max}, dropped ${r}`);
        else if (accept(c, r)) out.push(c);
      }
      return out;
    };

    const reject = (issue: string) => {
      issues.push(`${label}: ${issue}`);
      return false;
    };
    const listed = new Set<PlanCandidate>();
    const once = (key: string) => (c: PlanCandidate, r: string) => (listed.has(c) ? reject(`${key} repeats ${r} from another list`) : !!listed.add(c));

    const take = refsIn("take", (c, r) => !takenEarlier.has(c.player.id) || reject(`take ${r} was already drafted earlier`), picks.length);
    const targets = refsIn("targets", once("targets"), LIMITS.targets);
    const fallbacks = refsIn("fallbacks", once("fallbacks"), LIMITS.fallbacks);
    const letGo = refsIn(
      "letGo",
      (c, r) => {
        if (c.odds >= FALLBACK_ODDS) return reject(`letGo ${r} has ${Math.round(c.odds * 100)}% odds`);
        if (takenEarlier.has(c.player.id) || targetedEarlier.has(c.player.id)) return reject(`letGo ${r} was planned earlier`);
        if (take.includes(c)) return reject(`letGo ${r} is also taken`);
        return once("letGo")(c, r);
      },
      LIMITS.letGo,
    );

    if (!targets.length) {
      issues.push(`${label}: no valid targets, turn dropped`);
      continue;
    }
    // A short take list is filled from the targets, in order.
    for (const c of targets) {
      if (take.length >= picks.length) break;
      if (take.includes(c) || takenEarlier.has(c.player.id)) continue;
      issues.push(`${label}: take had ${take.length} of ${picks.length}, added target ${c.ref}`);
      take.push(c);
    }
    const ids = (list: PlanCandidate[]) => list.map((c) => c.player.id);
    turns.push({ picks, note: text(answer.note, LIMITS.note), take: ids(take), targets: ids(targets), fallbacks: ids(fallbacks), letGo: ids(letGo) });
    for (const c of take) takenEarlier.add(c.player.id);
    for (const c of targets) targetedEarlier.add(c.player.id);
  }

  if (!turns.length) return { ok: false, issues: [...issues, "no usable turns"] };
  const roster = fillStartingSlots(turns, input, issues);
  for (const { pos, have, need } of rosterShortfalls(roster, input)) issues.push(`roster: ${have} ${pos} for ${need} starting slot${need > 1 ? "s" : ""}`);
  return { ok: true, plan: { intro: text(raw.intro, LIMITS.intro), turns }, issues };
}

/** Dedicated starting slots (QB, RB, WR, TE, K, D/ST) the plan's take lists leave unfilled. Flex slots aren't checked. */
export function rosterShortfalls(roster: Pick<Player, "pos">[], input: Pick<PlanInput, "league">): { pos: Position; have: number; need: number }[] {
  const slots = slotCounts(input.league.roster);
  return POSITIONS.map((pos) => ({ pos, have: roster.filter((p) => p.pos === pos).length, need: slots[pos] })).filter((x) => x.have < x.need);
}

/**
 * Filling the starting lineup is arithmetic the model gets wrong often enough (two D/STs and no K)
 * that the plan shouldn't depend on it. For each dedicated slot the take lists leave empty, walks
 * back from the last turn for a turn that offers a player at that position with real odds, and swaps
 * out one of its takes at a position already past its starting slots, preferring a spare K or D/ST.
 * The swapped-in player moves to the top of the turn's targets. Returns the resulting roster.
 */
function fillStartingSlots(turns: AiPlanTurn[], input: PlanInput, issues: string[]): Player[] {
  const slots = slotCounts(input.league.roster);
  const candidates = new Map(input.turns.map((t) => [t.picks[0], t.candidates]));
  const byId = new Map(input.turns.flatMap((t) => t.candidates.map((c) => [c.player.id, c] as const)));
  const roster = () => turns.flatMap((t) => t.take).map((id) => byId.get(id)!.player);
  const extra = (pos: Position) => roster().filter((p) => p.pos === pos).length - slots[pos];

  for (const { pos } of rosterShortfalls(roster(), input)) {
    while (extra(pos) < 0) {
      const taken = new Set(turns.flatMap((t) => t.take));
      const swaps = turns.toReversed().flatMap((turn) => {
        const fill = candidates.get(turn.picks[0])!.find((c) => c.player.pos === pos && c.odds >= FALLBACK_ODDS && !taken.has(c.player.id));
        if (!fill) return [];
        return turn.take
          .map((id, i) => ({ turn, fill, i, pos: byId.get(id)!.player.pos }))
          .filter((x) => extra(x.pos) > 0)
          .toReversed();
      });
      // A spare K or D/ST is dead weight on a bench, so swap one of those out first; otherwise the latest pick.
      const swap = swaps.find((x) => LATE_POSITIONS.includes(x.pos)) ?? swaps[0];
      if (!swap) break;

      const { turn, fill, i } = swap;
      const id = fill.player.id;
      issues.push(`roster: picks ${turn.picks.join(" & ")} takes ${fill.ref} instead of ${byId.get(turn.take[i])!.ref} to fill the empty ${pos} slot`);
      turn.take[i] = id;
      turn.targets = [id, ...turn.targets.filter((x) => x !== id)].slice(0, LIMITS.targets);
      turn.fallbacks = turn.fallbacks.filter((x) => x !== id);
      turn.letGo = turn.letGo.filter((x) => x !== id);
    }
  }
  return roster();
}
