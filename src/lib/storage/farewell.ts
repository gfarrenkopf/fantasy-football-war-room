import { roundsOf, totalPicks } from "@/lib/draft/snake";
import type { DraftState } from "@/lib/draft/types";
import type { LeagueRecord, Stores } from "./types";

/**
 * What the landing page's goodbye says after a sign-out (the entry panel's farewell face). Signing
 * out clears this device's copy of the account, so the summary is taken just before, handed across
 * the reload in sessionStorage (this tab only), and read exactly once. Nothing goes in the URL.
 */
export interface FarewellLeague {
  name: string;
  season: number;
  teams: number;
  rounds: number;
  /** Picks in the whole draft. */
  total: number;
  /** Picks logged so far. */
  logged: number;
  /** The user's first few picks, as player ids, in draft order. */
  mine: string[];
}

export interface Farewell {
  email: string | null;
  leagues: FarewellLeague[];
}

/** Unfinished beats done: a paused draft is the reason to come back. */
export type FarewellMood = "unfinished" | "done" | "fresh";

const KEY = "fwr:v1:farewell";
/** How many of the user's picks a finished league's team card shows. */
const CORE = 3;

export const isUnfinished = (l: FarewellLeague) => l.logged > 0 && l.logged < l.total;
export const isDone = (l: FarewellLeague) => l.total > 0 && l.logged >= l.total;

export function farewellMood(f: Farewell | null): FarewellMood {
  if (!f) return "fresh";
  if (f.leagues.some(isUnfinished)) return "unfinished";
  if (f.leagues.some(isDone)) return "done";
  return "fresh";
}

/** One league's line in the goodbye, from its record and its draft (null when never started). */
export function summarizeLeague(league: LeagueRecord, draft: DraftState | null): FarewellLeague {
  const picks = draft?.picks ?? [];
  return {
    name: league.name,
    season: league.season,
    teams: league.settings.teams,
    rounds: roundsOf(league.settings),
    total: totalPicks(league.settings),
    logged: picks.length,
    mine: picks
      .filter((p) => p.mine)
      .slice(0, CORE)
      .map((p) => p.playerId),
  };
}

/** Reads every league and its draft from the signed-in stores, before signing out clears them. */
export async function gatherFarewell(stores: Stores, email: string | null): Promise<Farewell> {
  const leagues = await stores.league.listLeagues();
  const drafts = await Promise.all(leagues.map((l) => stores.draft.getDraftState(l.id).catch(() => null)));
  return { email, leagues: leagues.map((l, i) => summarizeLeague(l, drafts[i])) };
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveFarewell(farewell: Farewell, storage: Storage | null = sessionStore()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(farewell));
  } catch {
    // Full or blocked storage: the goodbye falls back to its generic line.
  }
}

/** The goodbye left by the sign-out, removed as it's read so a reload never replays it. */
export function takeFarewell(storage: Storage | null = sessionStore()): Farewell | null {
  try {
    const raw = storage?.getItem(KEY);
    storage?.removeItem(KEY);
    return raw ? parseFarewell(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function parseFarewell(v: unknown): Farewell | null {
  if (!v || typeof v !== "object") return null;
  const { email, leagues } = v as Record<string, unknown>;
  if (!(email === null || typeof email === "string") || !Array.isArray(leagues)) return null;
  const valid = leagues.filter(
    (l): l is FarewellLeague =>
      !!l &&
      typeof l === "object" &&
      typeof l.name === "string" &&
      isNum(l.season) &&
      isNum(l.teams) &&
      isNum(l.rounds) &&
      isNum(l.total) &&
      isNum(l.logged) &&
      Array.isArray(l.mine) &&
      l.mine.every((id: unknown) => typeof id === "string"),
  );
  return { email, leagues: valid };
}
