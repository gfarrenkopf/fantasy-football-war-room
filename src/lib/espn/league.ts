import { rosterFromCounts, type SlotCounts } from "@/lib/draft/league";
import type { LeagueSettings, RosterSlotKey, ScoringFormat } from "@/lib/draft/types";

/**
 * ESPN's league settings, turned into ours (8.8). Pure: the bridge reads `mSettings` in the user's
 * own tab and posts it here, so the war room's league can come from ESPN rather than being typed in
 * twice and quietly disagreeing.
 *
 * Unofficial and reverse-engineered like the rest of Epic 8 (docs/espn-protocol.md §2): every field
 * is checked, and anything we don't recognise is a refusal with a reason the user can act on, never
 * a guess.
 */

/** ESPN's lineup slot ids → our roster slots. Anything else (IR, and the ones no league uses) is ignored. */
const SLOT_BY_ESPN_ID: Record<number, RosterSlotKey> = {
  0: "QB",
  2: "RB",
  4: "WR",
  6: "TE",
  7: "SUPERFLEX", // ESPN calls it OP (offensive player)
  16: "DST",
  17: "K",
  20: "BN",
  23: "FLEX",
};

/** Slots ESPN supports that we can't represent, with the words to tell the user. */
const UNSUPPORTED: Record<number, string> = {
  1: "team QB",
  3: "RB/WR flex",
  5: "WR/TE flex",
  8: "defensive player",
  9: "defensive tackle",
  10: "defensive end",
  11: "linebacker",
  12: "cornerback",
  13: "safety",
  14: "defensive back",
  15: "defensive lineman",
  18: "punter",
  19: "head coach",
  22: "utility",
  24: "edge rusher",
};

/** ESPN's `reception` scoring item. 1 point is full PPR, 0.5 half, anything else standard. */
const RECEPTION_STAT = 53;

/** The slice of `mSettings` we use. Everything is optional: this is ESPN's shape, not ours. */
export interface EspnSettings {
  size?: number;
  /** `date` is the scheduled draft, in epoch milliseconds; 0 or missing when the commissioner hasn't set one. */
  draftSettings?: { type?: string; pickOrder?: number[]; date?: number };
  rosterSettings?: { lineupSlotCounts?: Record<string, number> };
  scoringSettings?: { scoringItems?: { statId?: number; points?: number }[] };
}

export type EspnImport = (
  | { ok: true; league: Omit<LeagueSettings, "valueThreshold">; rounds: number }
  /** Why this ESPN league can't become a war room league, in words for the user. */
  | { ok: false; error: string }
) & {
  /**
   * When ESPN has the draft scheduled, as an ISO instant (LeagueRecord.draftAt). On both branches:
   * the pick order is only drawn an hour before, so before then the import is usually `ok: false`
   * and the date is the one thing worth taking from it. Absent when ESPN has none.
   */
  draftAt?: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Validates the raw JSON the bridge posted. Null when it isn't ESPN's settings at all. */
export function parseEspnSettings(raw: unknown): EspnSettings | null {
  if (!isObject(raw)) return null;
  const settings = isObject(raw.settings) ? raw.settings : raw;
  const size = settings.size;
  if (typeof size !== "number" || !Number.isInteger(size)) return null;
  return settings as EspnSettings;
}

export function scoringOf(settings: EspnSettings): ScoringFormat {
  const item = settings.scoringSettings?.scoringItems?.find((i) => i?.statId === RECEPTION_STAT);
  const points = typeof item?.points === "number" ? item.points : 0;
  return points >= 1 ? "ppr" : points >= 0.5 ? "half" : "std";
}

/**
 * The user's draft slot: where their team sits in ESPN's pick order.
 *
 * ESPN randomizes `pickOrder` when the lobby opens, an hour before the draft (§2), so this is read
 * again every time the bridge checks in rather than once at import.
 */
export function slotOf(settings: EspnSettings, espnTeamId: number): number | null {
  const order = settings.draftSettings?.pickOrder;
  if (!Array.isArray(order)) return null;
  const at = order.indexOf(espnTeamId);
  return at < 0 ? null : at + 1;
}

/** ESPN's lineup slot counts as ours, or the first slot we can't represent. */
function rosterOf(settings: EspnSettings): { counts: Partial<SlotCounts> } | { error: string } {
  const counts = settings.rosterSettings?.lineupSlotCounts;
  if (!isObject(counts)) return { error: "ESPN didn't say what this league's roster looks like." };
  const out: Partial<SlotCounts> = {};
  for (const [id, n] of Object.entries(counts)) {
    if (typeof n !== "number" || n <= 0) continue;
    const espnId = Number(id);
    if (espnId === 21) continue; // IR: not part of the draft
    const key = SLOT_BY_ESPN_ID[espnId];
    if (!key) {
      const what = UNSUPPORTED[espnId] ?? `slot ${espnId}`;
      return { error: `This league starts a ${what}, which War Room can't draft for yet.` };
    }
    out[key] = (out[key] ?? 0) + n;
  }
  return { counts: out };
}

/** ESPN's scheduled draft time as an ISO instant, or null when the commissioner hasn't set one. */
export function draftAtOf(settings: EspnSettings): string | null {
  const ms = settings.draftSettings?.date;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const at = new Date(ms);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * ESPN's settings as a war room league. `valueThreshold` is left out: it's the user's own
 * preference, not ESPN's, so the caller keeps whatever the league already had.
 */
export function toLeagueSettings(raw: unknown, espnTeamId: number): EspnImport {
  const settings = parseEspnSettings(raw);
  if (!settings) return { ok: false, error: "That doesn't look like an ESPN league." };
  const imported = importOf(settings, espnTeamId);
  const draftAt = draftAtOf(settings);
  return draftAt ? { ...imported, draftAt } : imported;
}

function importOf(settings: EspnSettings, espnTeamId: number): EspnImport {

  const type = settings.draftSettings?.type;
  if (type && type !== "SNAKE") {
    return { ok: false, error: type === "AUCTION" ? "War Room doesn't do auction drafts yet." : `War Room doesn't do ${type.toLowerCase()} drafts yet.` };
  }

  const teams = settings.size;
  if (typeof teams !== "number" || teams < 2) return { ok: false, error: "ESPN didn't say how many teams this league has." };

  const mySlot = slotOf(settings, espnTeamId);
  if (mySlot === null) return { ok: false, error: "ESPN hasn't set the draft order yet. It's drawn when the draft room opens, about an hour before." };

  const roster = rosterOf(settings);
  if ("error" in roster) return { ok: false, error: roster.error };
  const slots = rosterFromCounts(roster.counts);
  if (!slots.length) return { ok: false, error: "ESPN didn't say what this league's roster looks like." };

  return { ok: true, league: { teams, mySlot, scoring: scoringOf(settings), roster: slots }, rounds: slots.length };
}

/** What an import would change about the open league, in words. Empty when they already agree. */
export function leagueDifferences(current: LeagueSettings, imported: Omit<LeagueSettings, "valueThreshold">): string[] {
  const out: string[] = [];
  if (current.teams !== imported.teams) out.push(`${imported.teams} teams, not ${current.teams}`);
  if (current.mySlot !== imported.mySlot) out.push(`you pick at ${imported.mySlot}, not ${current.mySlot}`);
  if (current.scoring !== imported.scoring) out.push(`${SCORING_WORDS[imported.scoring]}, not ${SCORING_WORDS[current.scoring]}`);
  if (current.roster.length !== imported.roster.length) out.push(`${imported.roster.length} rounds, not ${current.roster.length}`);
  else if (current.roster.map((s) => s.key).join() !== imported.roster.map((s) => s.key).join()) out.push("a different roster");
  return out;
}

const SCORING_WORDS: Record<ScoringFormat, string> = { ppr: "full PPR", half: "half PPR", std: "standard scoring" };
