import type { AiLineup } from "@/lib/ai/season/lineup";
import { aiLineupStatus } from "@/lib/ai/season/lineupStatus";
import type { SeasonAiState, StoredAiOutput } from "@/lib/ai/season/state";
import type { AiTradeWriteup } from "@/lib/ai/season/trade";
import type { TradeIdea } from "@/lib/ai/season/tradeIdeas";
import { label } from "@/lib/season/apply";
import type { Trade } from "@/lib/season/trade";
import { ideaStatus, type IdeaKind } from "@/lib/season/tradeIdeas";
import type { SeasonView } from "@/lib/season/view";
import { tradeGrade, type TradeGrade } from "./team";

/**
 * /api/v1/leagues/:id/ai/* (APE-390): in-season AI in the iPhone app (Epic 20), as the web's AI
 * lineup card, trade ideas and trade write-up show it (AiPanel.tsx, TradeIdeas.tsx). The server
 * writes and gates; these add what those components work out, so the app only shows it.
 *
 * Nothing here mentions buying. App Store guideline 3.1.1 bars pointing to an outside purchase, so
 * a locked league is told that the season pass is on draftroom.online, with no link and no price.
 */

/** Where the account stands: unlocked (a pass, the allowlist, or payments off), in its free trial, or past it with no pass. */
export type AiAccess = { state: "unlocked" } | { state: "trial"; trialWeek: number; trialWeeks: number; note: string } | { state: "locked"; note: string };

/** What a locked league is told, in place of the web's checkout. */
export const AI_LOCKED =
  "Your free weeks of AI are over. AI lineups, trade ideas and trade write-ups come with this league's season pass, on draftroom.online. The recommended lineup and trade verdicts stay free.";

export interface AiPlayer {
  id: number;
  name: string;
}

/** This week's AI lineup, as the web's card shows it. */
export interface AiLineupView {
  intro: string;
  createdAt: string;
  /** Projected points of the AI's starters. */
  total: number;
  /** "Start X over Y at RB: a close call…", when the AI called a close one differently from the recommended lineup. */
  departures: string | null;
  /** The slots the AI wrote a reason for. */
  calls: { slot: string; player: AiPlayer | null; reason: string }[];
  /** Every starting slot the AI fills, for "Use this lineup". */
  starters: { key: AiLineup["slots"][number]["key"]; playerId: number | null; locked: boolean }[];
  /** Whether ESPN starts the AI's lineup now, said the web's way. */
  espn: { matches: boolean; text: string };
}

/** One of this week's trade ideas, graded again against the rosters now. */
export interface AiIdeaView {
  kind: IdeaKind;
  /** "Win-win" or "Bold swing". */
  label: string;
  partner: AiPlayer;
  gives: AiPlayer[];
  gets: AiPlayer[];
  /**
   * ok; stale: a player has left either roster; blocked: a player is in another trade; offered:
   * already offered on ESPN. `note` says the last three in words.
   */
  status: "ok" | "stale" | "blocked" | "offered";
  note: string | null;
  /** The live grade; null once stale. */
  grade: TradeGrade | null;
  /** "Numbers moved since it was found: +1.2 → +0.4 a week for you.", when they moved half a point or more. */
  moved: string | null;
  why: string;
  pitch: string;
  /** Whether it can still be offered on ESPN. */
  canOffer: boolean;
}

export interface AiIdeasView {
  createdAt: string;
  ideas: AiIdeaView[];
  /** Why a kind is missing, in the web's words. */
  missing: string[];
}

/** GET ai: the Lineup tab's AI card and the Trades tab's ideas, and what each can do next. */
export interface AiResponse {
  access: AiAccess;
  week: number;
  /** The newest of this week's AI lineups; null before one is written, and while locked. */
  lineup: AiLineupView | null;
  /** write: none yet; rewrite: one is stored and the mid-week allowance is unused (the web's "Rewrite with the latest news"). */
  lineupAction: "write" | "rewrite" | null;
  /** Said in place of the button once this week's mid-week lineup is used and none is stored. */
  lineupNote: string | null;
  ideas: AiIdeasView | null;
  /** Whether "Find trades" shows: no ideas yet, before the deadline, and not locked. */
  canFindIdeas: boolean;
}

export interface AiWriteupView {
  lean: AiTradeWriteup["lean"];
  /** "Accept", "Decline" or "Counter". */
  leanLabel: string;
  summary: string;
  reasons: string[];
  /** The counter-offer, said the web's way, and as a trade to check in the builder. */
  counter: { give: AiPlayer[]; get: AiPlayer[]; note: string; text: string } | null;
  createdAt: string;
}

const KIND: Record<IdeaKind, string> = { safe: "Win-win", bold: "Bold swing" };
const MISSING: Record<IdeaKind, string> = {
  safe: "No win-win this week: every trade that helps you costs the other team.",
  bold: "No bolder swing this week that a partner would plausibly take.",
};
const LEAN: Record<AiTradeWriteup["lean"], string> = { accept: "Accept", decline: "Decline", counter: "Counter" };
/** The idea's numbers have moved enough since it was found that the card says so (TradeIdeas.tsx). */
const MOVED = 0.5;

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

function namer(view: SeasonView, extra: Record<number, string> = {}) {
  const names = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
  return (id: number) => names.get(id) ?? extra[id] ?? `ESPN player ${id}`;
}

const teamName = (view: SeasonView, id: number) => view.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

export function aiAccess(state: SeasonAiState["access"]): AiAccess {
  if (state.kind === "needs-purchase") return { state: "locked", note: AI_LOCKED };
  if (state.kind === "trial") return { state: "trial", trialWeek: state.trialWeek, trialWeeks: state.trialWeeks, note: `Free trial · week ${state.trialWeek} of ${state.trialWeeks}` };
  return { state: "unlocked" };
}

/** The newest of this week's AI lineups: mid-week, Sunday's (11.3), or a mid-week one written after Sunday's (AiPanel.tsx's latest()). */
export function latestLineup(ai: SeasonAiState): StoredAiOutput<AiLineup> | undefined {
  return [ai.lineups["lineup-sunday"], ai.lineups["lineup-midweek"]].filter((x) => x !== undefined).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function aiLineupView(view: SeasonView, stored: StoredAiOutput<AiLineup>): AiLineupView {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const names = new Map(roster.map((p) => [p.playerId, p.name]));
  const name = (id: number | null) => (id === null ? "nobody" : (names.get(id) ?? `ESPN player ${id}`));
  const { output } = stored;
  const departures = output.slots.filter((slot) => slot.playerId !== slot.enginePlayerId);
  // Live, against ESPN now: the stored text was written against the lineup ESPN had then.
  const status = aiLineupStatus(output, roster);
  const espn =
    (status.missing.length === 0 ? "ESPN has the AI's starters." : `Not on ESPN yet: ${status.missing.map((m) => `${name(m.playerId)} at ${label(m.key)}`).join(", ")}.`) +
    (status.changedSince ? " You've changed your ESPN lineup since this was written, so what it says about the lineup on ESPN is out of date." : "");
  return {
    intro: output.intro,
    createdAt: stored.createdAt,
    total: output.total,
    departures: departures.length
      ? `${departures.map((slot) => `Start ${name(slot.playerId)} over ${name(slot.enginePlayerId)} at ${label(slot.key)}`).join(". ")}: a close call the AI makes differently from the recommended lineup.`
      : null,
    calls: output.slots.flatMap((slot) =>
      slot.reason ? [{ slot: label(slot.key), player: slot.playerId === null ? null : { id: slot.playerId, name: name(slot.playerId) }, reason: slot.reason }] : [],
    ),
    starters: output.slots.map((slot) => ({ key: slot.key, playerId: slot.playerId, locked: slot.locked })),
    espn: { matches: status.missing.length === 0, text: espn },
  };
}

export function aiIdeaView(view: SeasonView, idea: TradeIdea): AiIdeaView {
  const trade: Trade = { teamA: view.myTeamId, gives: idea.gives, teamB: idea.partner, gets: idea.gets };
  const status = ideaStatus(view, trade);
  const name = namer(view, idea.names);
  const players = (ids: readonly number[]) => ids.map((id) => ({ id, name: name(id) }));
  const list = (ids: readonly number[]) => ids.map(name).join(", ");
  const grade = status.kind === "stale" ? null : tradeGrade(view, trade);
  const live = status.kind === "stale" ? null : status.verdict.a.perWeek;
  const note =
    status.kind === "stale"
      ? `${list(status.missing)} ${status.missing.length === 1 ? "isn't" : "aren't"} on those rosters any more, so this one has passed.`
      : status.kind === "blocked"
        ? `${list(status.ids)} ${status.ids.length === 1 ? "is" : "are"} in another trade right now, so ESPN won't take this offer yet.`
        : status.kind === "offered"
          ? "Offered on ESPN. It's in Pending."
          : null;
  return {
    kind: idea.kind,
    label: KIND[idea.kind],
    partner: { id: idea.partner, name: teamName(view, idea.partner) },
    gives: players(idea.gives),
    gets: players(idea.gets),
    status: status.kind,
    note,
    grade,
    moved: live !== null && Math.abs(live - idea.found.you) >= MOVED ? `Numbers moved since it was found: ${signed(idea.found.you)} → ${signed(live)} a week for you.` : null,
    why: idea.why,
    pitch: idea.pitch,
    canOffer: !view.tradeDeadlinePassed && status.kind !== "offered" && status.kind !== "stale" && status.kind !== "blocked",
  };
}

export function aiResponse(view: SeasonView, ai: SeasonAiState): AiResponse {
  const access = aiAccess(ai.access);
  const locked = access.state === "locked";
  const stored = locked ? undefined : latestLineup(ai);
  const ideas = ai.tradeIdeas;
  return {
    access,
    week: view.currentWeek,
    lineup: stored ? aiLineupView(view, stored) : null,
    lineupAction: locked || ai.midweekUsed ? null : stored ? "rewrite" : "write",
    lineupNote: !locked && !stored && ai.midweekUsed ? "This week's mid-week AI lineup is used. The Sunday one comes after the inactives are posted." : null,
    // Stored ideas stay readable after the trial, as on the web.
    ideas: ideas
      ? { createdAt: ideas.createdAt, ideas: ideas.output.ideas.map((idea) => aiIdeaView(view, idea)), missing: ideas.output.missing.map((kind) => MISSING[kind]) }
      : null,
    canFindIdeas: !ideas && !locked && !view.tradeDeadlinePassed,
  };
}

export function aiWriteupView(view: SeasonView, stored: StoredAiOutput<AiTradeWriteup>): AiWriteupView {
  const name = namer(view);
  const players = (ids: readonly number[]) => ids.map((id) => ({ id, name: name(id) }));
  const list = (ids: readonly number[]) => ids.map(name).join(", ") || "nobody";
  const { output } = stored;
  const { counter } = output;
  return {
    lean: output.lean,
    leanLabel: LEAN[output.lean],
    summary: output.summary,
    reasons: output.reasons,
    counter: counter
      ? { give: players(counter.give), get: players(counter.get), note: counter.note, text: `Send ${list(counter.give)}; ask for ${list(counter.get)}. ${counter.note}`.trim() }
      : null,
    createdAt: stored.createdAt,
  };
}
