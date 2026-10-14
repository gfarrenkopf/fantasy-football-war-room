import { biggestSurprises, trackRecord, type CallRecord, type PlayerCall, type ProjectionAccuracy, type ProjectionCall } from "@/lib/season/accuracy";
import { canPlay, irEligible, seatsFromRoster, starterSeats, alignSeats } from "@/lib/season/apply";
import { lineupEmphasis, type Emphasis } from "@/lib/season/emphasis";
import {
  aroundTheLeague,
  gameDayBench,
  gameProgress,
  headToHead,
  leftToPlay,
  matchupDecided,
  matchupLive,
  pace,
  scoreboardState,
  type GameDayPhase,
  type Pace,
} from "@/lib/season/gameday";
import { findHoles, type Hole } from "@/lib/season/holes";
import { compareLineups } from "@/lib/season/lineup";
import { weekRecap, type WeekRecap } from "@/lib/season/recap";
import { LINEUP_HEADLINE, outTag, startSitSwaps, type OutTag, type StartSitSwap } from "@/lib/season/startSit";
import { weekSwing, type WeekSwing } from "@/lib/season/swing";
import type { LineupSlot, LineupSlotCount } from "@/lib/season/types";
import type { SeasonView } from "@/lib/season/view";
import type { WeekFacts } from "@/lib/season/weekFacts";

/**
 * GET /api/v1/leagues/:id/season (APE-379): everything the season page's Game day and Lineup tabs
 * show, for the iPhone app, which draws them without computing anything itself. Every derived value
 * comes from the same functions the web components use.
 *
 * These interfaces are the contract the app's Codable types copy. Fields may be added, never
 * removed or renamed: a breaking change is /api/v2 (docs/ios.md).
 */

export type SeasonTab = "gameday" | "lineup" | "trade" | "waivers";

export interface SeasonResponse {
  league: { id: string; name: string };
  /** When ESPN was read, as an ISO instant, and whether that read is an older one kept because ESPN couldn't be reached. */
  fetchedAt: string;
  stale: boolean;
  /** ESPN's projections didn't load, so every player shows 0. */
  projectionsMissing: boolean;
  phase: GameDayPhase;
  /** The tab to open on a cold launch or league switch: Lineup between weeks, Game day otherwise. */
  defaultTab: SeasonTab;
  tabs: SeasonTab[];
  /** This week's league, as the Lineup tab reads it. */
  view: SeasonView;
  /** Last week while its result is still up (Tuesday to Wednesday 9 AM ET); Game day shows it instead of `view`. */
  result: SeasonView | null;
  /** The user's matchup on the week Game day shows; null without one. Its shape is reused by the Live Activity (APE-397). */
  live: LiveMatchup | null;
  gameDay: GameDay;
  lineup: Lineup;
  /** The ESPN write consent: its text and version, and whether the user has agreed to this version. */
  consent: { version: number; lines: readonly string[]; agreed: boolean };
}

export interface LiveSide {
  teamId: number;
  name: string;
  points: number;
  projected: number;
  /** Starters still to finish. */
  left: number;
}

export interface LiveMatchup {
  week: number;
  /** "Live", "Final", "3 left for Opponent", "5 to play" or "Up next". */
  status: string;
  /** A game on either side is under way. */
  live: boolean;
  /** A starter on either side has kicked off; before then, show the projections. */
  started: boolean;
  decided: boolean;
  /** The user's points less their opponent's. */
  lead: number;
  /** ESPN's chance the user wins, as a whole percent; null when ESPN didn't say. */
  win: number | null;
  me: LiveSide;
  them: LiveSide;
}

export interface PlayerPace {
  pace: Pace;
  /** How far through his game the clock is, 0–1, while it's under way; null otherwise. */
  progress: number | null;
}

export interface GameDay {
  /** The week Game day shows: last week while its result is up, otherwise this week. */
  week: number;
  /** The user's starters against their opponent's, slot by slot. Empty without a matchup. */
  headToHead: { key: LineupSlotCount["key"]; me: number | null; them: number | null }[];
  /** Without a matchup: the user's starters as set on ESPN, slot by slot, null where ESPN has it empty. */
  starters: { key: LineupSlotCount["key"]; playerId: number | null }[];
  /** Each player on either side of the matchup (the user's whole roster), against his projection. */
  pace: Record<number, PlayerPace>;
  /** The league's other matchups, and the starters left to play in each; only while games are live. */
  around: { home: LiveSide; away: LiveSide; left: number }[];
  /** The user's bench, best first, and the points scored on it. */
  bench: { playerIds: number[]; points: number };
  /** Starting slots nobody on the roster can play this week; fixed on the Lineup tab. */
  holes: Hole[];
  /** The decided week (phase "results"): the result and how the week swung. */
  result: { recap: WeekRecap; swing: WeekSwing | null } | null;
  /** ESPN's call while the week is on or decided. */
  espnCall: EspnCall | null;
  /** ESPN's season on the user's team, between weeks. */
  trackRecord: TrackRecord | null;
  /** Last week's final, between weeks, until the recap archive tells it. */
  lastWeek: WeekRecap | null;
  /** Whether to show the recap archive (18.6): whenever no game is on. */
  showArchive: boolean;
}

export interface EspnCall {
  me: ProjectionCall | null;
  them: ProjectionCall | null;
  /** The user's players who most beat and most missed ESPN's call. */
  best: PlayerCall | null;
  worst: PlayerCall | null;
  season: CallRecord | null;
}

export interface TrackRecord extends CallRecord {
  overcalled: number;
  surest: CallRecord & { playerId: number };
  shakiest: CallRecord & { playerId: number };
}

export interface Lineup {
  /** Every starting seat in order: RB twice for two RBs. */
  seats: LineupSlotCount["key"][];
  /** Who sits in each seat on ESPN now, and in War Room's lineup, seat for seat; null for an empty seat. */
  onEspn: (number | null)[];
  recommended: (number | null)[];
  /** For each of the user's players, the slots he may move to: the seats his position can play, the bench, and IR when ESPN allows it. */
  eligible: Record<number, LineupSlot[]>;
  /** Why a player would come out, when it's news: OUT, BYE, LIKELY OUT. */
  tags: Record<number, OutTag>;
  startSit: StartSit;
  /** Starting slots nobody can play (hard) or that may need a backup (soft). */
  holes: Hole[];
}

export interface StartSit {
  level: Emphasis;
  headline: string;
  /** Projected points of War Room's lineup over ESPN's, and both totals. */
  gain: number;
  total: number;
  currentTotal: number;
  swaps: StartSitSwap[];
  /** What War Room's moves have already gained this week (view.warRoomMoves). */
  banked: number;
}

export interface SeasonInput {
  league: { id: string; name: string };
  view: SeasonView;
  result?: SeasonView;
  previous?: SeasonView;
  phase: GameDayPhase;
  fetchedAt: Date;
  stale: boolean;
  projectionsMissing: boolean;
  accuracy: ProjectionAccuracy | null;
  previousAccuracy: ProjectionAccuracy | null;
  kept: readonly WeekFacts[];
  consent: { version: number; lines: readonly string[]; consented: number | null };
}

const TABS: SeasonTab[] = ["gameday", "lineup", "trade", "waivers"];

export function seasonResponse(input: SeasonInput): SeasonResponse {
  const { view, phase, consent } = input;
  const shown = input.result ?? view;
  return {
    league: input.league,
    fetchedAt: input.fetchedAt.toISOString(),
    stale: input.stale,
    projectionsMissing: input.projectionsMissing,
    phase,
    defaultTab: phase === "lineup" ? "lineup" : "gameday",
    tabs: TABS,
    view,
    result: input.result ?? null,
    live: liveMatchup(shown, phase),
    gameDay: gameDay(shown, input),
    lineup: lineup(view),
    consent: { version: consent.version, lines: consent.lines, agreed: (consent.consented ?? 0) >= consent.version },
  };
}

const teamName = (view: SeasonView, teamId: number) => view.teams.find((t) => t.id === teamId)?.name ?? `Team ${teamId}`;

function side(view: SeasonView, s: { teamId: number; points: number; projected: number }): LiveSide {
  return { teamId: s.teamId, name: teamName(view, s.teamId), points: s.points, projected: s.projected, left: leftToPlay(view, s.teamId) };
}

/** The scoreboard, as GameDayPanel's Scoreboard shows it. */
export function liveMatchup(view: SeasonView, phase: GameDayPhase): LiveMatchup | null {
  if (!view.matchup) return null;
  const opponent = view.teams.find((t) => t.id === view.matchup!.them.teamId)?.name ?? "Your opponent";
  const board = scoreboardState(view, phase, opponent)!;
  return { week: view.currentWeek, ...board, live: matchupLive(view), me: side(view, view.matchup.me), them: side(view, view.matchup.them) };
}

function gameDay(view: SeasonView, input: SeasonInput): GameDay {
  const { phase, accuracy, previous, previousAccuracy, kept } = input;
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const theirs = view.matchup ? (view.teams.find((t) => t.id === view.matchup!.them.teamId)?.roster ?? []) : [];
  const bench = gameDayBench(roster);
  const offDay = phase === "lineup";
  const decided = phase === "results" && matchupDecided(view);
  const recap = decided ? weekRecap(view, accuracy) : null;
  // The archive tells last week in full once it's kept; until then, its final stands in.
  const lastKept = previous && kept.some((w) => w.season === previous.season && w.week === previous.currentWeek);
  return {
    week: view.currentWeek,
    headToHead: view.matchup ? headToHead(view).map((r) => ({ key: r.key, me: r.me?.playerId ?? null, them: r.them?.playerId ?? null })) : [],
    starters: view.matchup ? [] : compareLineups(roster, view.lineup).map((r) => ({ key: r.key, playerId: r.now })),
    pace: Object.fromEntries(
      [...roster, ...theirs].map((p) => [p.playerId, { pace: pace(p), progress: p.game?.state === "in" ? gameProgress(p.game) : null }]),
    ),
    around: phase === "live" ? aroundTheLeague(view).map((m) => ({ home: side(view, m.home), away: side(view, m.away), left: m.left })) : [],
    bench: { playerIds: bench.players.map((p) => p.playerId), points: bench.points },
    holes: findHoles(view).filter((h) => h.kind === "hard"),
    result: recap ? { recap, swing: weekSwing(view, accuracy) } : null,
    espnCall: !offDay && accuracy ? espnCall(view, accuracy) : null,
    trackRecord: offDay && accuracy?.season ? track(view, accuracy.season) : null,
    lastWeek: offDay && previous && !lastKept ? weekRecap(previous, previousAccuracy) : null,
    showArchive: phase !== "live",
  };
}

function espnCall(view: SeasonView, accuracy: ProjectionAccuracy): EspnCall | null {
  const { me, them, season } = accuracy;
  if (!me && !them && !season) return null;
  const mine = new Set(view.teams.find((t) => t.id === view.myTeamId)?.roster.map((p) => p.playerId));
  const { best, worst } = biggestSurprises(accuracy.players.filter((p) => mine.has(p.playerId)));
  return { me, them, best, worst, season: season && { weeks: season.weeks, meanMiss: season.meanMiss, meanBias: season.meanBias } };
}

function track(view: SeasonView, season: NonNullable<ProjectionAccuracy["season"]>): TrackRecord | null {
  const mine = new Set(view.teams.find((t) => t.id === view.myTeamId)?.roster.map((p) => p.playerId));
  const record = trackRecord(season, mine);
  if (!record) return null;
  return { weeks: season.weeks, meanMiss: season.meanMiss, meanBias: season.meanBias, overcalled: season.overcalled, surest: record.surest, shakiest: record.shakiest };
}

function lineup(view: SeasonView): Lineup {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const seats = starterSeats(view.starters);
  const onEspn = seatsFromRoster(roster, seats);
  const keys = [...new Set(seats)];
  const plan = view.lineup;
  const suggested = plan.moves.length > 0;
  const gain = plan.total - plan.currentTotal;
  const level = suggested ? lineupEmphasis(gain) : "rest";
  const tags = roster.flatMap((p) => {
    const tag = outTag(p);
    return tag ? [[p.playerId, tag] as const] : [];
  });
  return {
    seats,
    onEspn,
    recommended: alignSeats(seats, onEspn, plan.starters.map((f) => f.playerId)),
    eligible: Object.fromEntries(
      roster.map((p) => [p.playerId, [...keys.filter((k) => canPlay(p.pos, k)), "BN", ...(view.irSlots > 0 && irEligible(p) ? ["IR"] : [])] as LineupSlot[]]),
    ),
    tags: Object.fromEntries(tags),
    startSit: {
      level,
      headline: LINEUP_HEADLINE[level],
      gain,
      total: plan.total,
      currentTotal: plan.currentTotal,
      swaps: startSitSwaps(roster, plan),
      banked: view.warRoomMoves.reduce((sum, m) => sum + m.gain, 0),
    },
    holes: findHoles(view),
  };
}
