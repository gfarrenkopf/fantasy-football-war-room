import { checkAcquire, checkCancel, checkClaim, dropCandidates, FAAB_CLAIMS, needsDrop, rosterLimit } from "@/lib/season/acquire";
import type { Fill, HoleFills, Hole } from "@/lib/season/holes";
import type { AheadFill, WeekHole } from "@/lib/season/holesAhead";
import { checkMoves, label, rosterChanges, type RosterSnapshot } from "@/lib/season/apply";
import { fillSteps, type FillPlan } from "@/lib/season/holeFill";
import type { FreeAgent } from "@/lib/season/types";
import { checkProposal, checkResponse } from "@/lib/season/tradeWrite";
import type { SeasonView } from "@/lib/season/view";
import { waiverNote, type Pickup } from "@/lib/season/waivers";
import type { AcquireBody, AcquireResult } from "../espn/acquireWrite";
import type { TradeBody, TradeResult } from "../espn/tradesWrite";

/**
 * /api/v1/leagues/:id/team/* (APE-386): managing the user's ESPN team from the iPhone app, as the
 * web's Waivers and Trades tabs do (Epic 13). The reads add what the web works out in its components;
 * the writes answer a dry run and a result in plain words, so the app shows them without working
 * anything out itself. The words are the web's.
 */

/** GET team/waivers: the web's waiver wire, plus what its Waivers tab works out from the season view. */
export interface WaiversResponse {
  pickups: Pickup[];
  ahead: { hole: WeekHole; fills: AheadFill[] }[];
  considered: number;
  fetchedAt: string;
  /** "Waiver priority 4 of 12", or FAAB left in a league that bids; null when ESPN gave neither. */
  note: string | null;
  /** Whether Draft Room claims in this league; it doesn't place FAAB bids yet, and `reason` says so. */
  claims: { allowed: boolean; reason: string | null };
  /** Who the user could drop to make room, weakest first, and whether an add needs one. */
  drops: { needed: boolean; candidates: number[] };
}

/** GET team/fills: this week's holes and how to fill them, as the web's hole card reads them. */
export interface FillsResponse {
  holes: Hole[];
  fills: HoleFills[];
}

/** `?dryRun=1` on a write: what it does, in words for the confirm sheet, and why it can't go to ESPN. Nothing is written. */
export interface TeamDryRun {
  text: string;
  problems: string[];
}

/** After a write ESPN took: whether the re-read shows it, and what to tell the user. The web's flags ride along. */
export type TeamApplied = { landed: boolean; result: string } & Partial<{ added: boolean; dropped: boolean; pending: boolean; cancelled: boolean; done: boolean }>;

/** `?dryRun=1` on a hole fill (APE-404): each step in words, in order, besides the summary. */
export interface FillDryRun extends TeamDryRun {
  steps: string[];
}

/**
 * After a hole fill: each step and whether ESPN shows it (null for a step never sent, because one
 * before it didn't land), what to tell the user, and why the step that stopped it did.
 */
export type FillApplied = TeamApplied & { steps: { text: string; landed: boolean | null }[]; details: string[] };

export function waiversResponse(view: SeasonView, load: { pickups: Pickup[]; ahead: WaiversResponse["ahead"]; considered: number; fetchedAt: Date }): WaiversResponse {
  const roster = mine(view);
  const bids = view.waiver.budget !== null;
  return {
    pickups: load.pickups,
    ahead: load.ahead,
    considered: load.considered,
    fetchedAt: load.fetchedAt.toISOString(),
    note: waiverNote(view),
    claims: { allowed: !bids, reason: bids ? FAAB_CLAIMS : null },
    drops: { needed: needsDrop(roster, rosterLimit(view.starters, view.benchSize)), candidates: dropCandidates(roster).map((p) => p.playerId) },
  };
}

/**
 * Why a write staged against `week` and `snapshot` no longer fits the season view, as the guarded
 * write would say it (src/lib/server/espn/guardedWrite.ts); null when it still does.
 */
export function staleAgainst(view: SeasonView, week: number, snapshot: RosterSnapshot | null): { kind: "changed"; changes: string[] } | null {
  if (view.currentWeek !== week) return { kind: "changed", changes: [`ESPN has moved on to week ${view.currentWeek}.`] };
  const changes = snapshot ? rosterChanges(snapshot, mine(view)) : [];
  return changes.length ? { kind: "changed", changes } : null;
}

const mine = (view: SeasonView) => view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];

/** Every rostered player's name, then a fallback. */
function namer(view: SeasonView, extra: Iterable<readonly [number, string]> = []) {
  const names = new Map([...view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)), ...extra]);
  return (id: number) => names.get(id) ?? `ESPN player ${id}`;
}

const list = (ids: readonly number[], name: (id: number) => string) => ids.map(name).join(", ");

/**
 * An add, claim or cancel against the season view, for the confirm sheet. `pooled` is the player
 * being added, from the waiver wire the app read; ESPN is checked again before the real write.
 */
export function acquireDryRun(view: SeasonView, body: AcquireBody, pooled: FreeAgent | null): TeamDryRun {
  if (body.kind === "cancel") {
    const claim = view.claims.find((c) => c.id === body.claimId);
    return { text: `Cancel your claim for ${claim?.add.name ?? "this player"}.`, problems: checkCancel(view.claims, body.claimId) };
  }
  const name = namer(view, pooled ? [[pooled.playerId, pooled.name]] : []);
  const roster = mine(view);
  const others = view.teams.filter((t) => t.id !== view.myTeamId);
  const limit = rosterLimit(view.starters, view.benchSize);
  const acquire = { add: body.add, drop: body.drop };
  if (body.kind === "claim") {
    return {
      text: `Claim ${name(body.add)} off waivers${body.drop === null ? "" : `, dropping ${name(body.drop)} if the claim goes through`}.`,
      problems: checkClaim(view.waiver.budget, roster, others, acquire, limit),
    };
  }
  return {
    text: `Add ${name(body.add)}${body.drop === null ? "" : ` and drop ${name(body.drop)}`}.`,
    problems: [...(pooled?.status === "WAIVERS" ? [`${pooled.name} is on waivers. Claim them instead.`] : []), ...checkAcquire(roster, others, acquire, limit)],
  };
}

export function acquireApplied(view: SeasonView, body: AcquireBody, landed: AcquireResult, pooled: FreeAgent | null): TeamApplied {
  if ("cancelled" in landed) {
    const who = view.claims.find((c) => body.kind === "cancel" && c.id === body.claimId)?.add.name ?? "this player";
    return {
      ...landed,
      landed: landed.cancelled,
      result: landed.cancelled ? `Claim for ${who} cancelled.` : `ESPN still shows your claim for ${who}. Check ESPN. Draft Room has been alerted.`,
    };
  }
  if (body.kind === "cancel") throw new Error("A cancel answered as an add");
  const name = namer(view, pooled ? [[pooled.playerId, pooled.name]] : []);
  const add = name(body.add);
  if ("pending" in landed) {
    return { ...landed, landed: landed.pending, result: landed.pending ? `Claim placed for ${add}.` : `ESPN doesn't show your claim for ${add}. Check ESPN. Draft Room has been alerted.` };
  }
  const dropped = body.drop === null ? "" : landed.dropped ? `, and ${name(body.drop)} is gone` : ", but your drop is still on your team";
  return {
    ...landed,
    landed: landed.added && landed.dropped,
    result: landed.added ? `Done. ${add} is on your team${dropped}.` : `ESPN doesn't show ${add} on your team. Check ESPN. Draft Room has been alerted.`,
  };
}

/** A hole fill against the season view, for the confirm sheet: each step, and why it can't go. ESPN checks every step again as it's sent. */
export function fillDryRun(view: SeasonView, hole: Pick<Hole, "key">, fill: Fill, plan: FillPlan): FillDryRun {
  const name = namer(view, [[fill.player.playerId, fill.player.name]]);
  const roster = mine(view);
  const afterIr = plan.ir ? roster.map((p) => (p.playerId === plan.ir!.move.playerId ? { ...p, slot: "IR" as const } : p)) : roster;
  const others = view.teams.filter((t) => t.id !== view.myTeamId);
  return {
    text: `Fill your ${label(hole.key)} hole with ${fill.player.name}.`,
    steps: fillSteps(plan, hole.key, name),
    problems: [
      ...(plan.ir ? checkMoves(roster, [plan.ir.move], view.starters, view.benchSize, view.irSlots) : []),
      ...checkAcquire(afterIr, others, { add: plan.add.add, drop: plan.add.drop }, rosterLimit(view.starters, view.benchSize)),
    ],
  };
}

/**
 * A hole fill ESPN took at least the first step of: `landed` is each step sent, in order, and the
 * last one is where it stopped when it's false. `details` is why that step didn't go. The words are
 * the web hole card's.
 */
export function fillApplied(view: SeasonView, hole: Pick<Hole, "key">, fill: Fill, plan: FillPlan, landed: readonly boolean[], details: string[]): FillApplied {
  const name = namer(view, [[fill.player.playerId, fill.player.name]]);
  const texts = fillSteps(plan, hole.key, name);
  const steps = texts.map((text, i) => ({ text, landed: i < landed.length ? landed[i] : null }));
  const add = fill.player.name;
  const slot = label(hole.key);
  if (landed.length === texts.length && landed.every(Boolean)) return { landed: true, result: `Done. ${add} starts at ${slot}.`, steps, details: [] };
  // The step that stopped it: 0 IR, 1 add, 2 start.
  const stopped = landed.length - (plan.ir ? 1 : 0);
  const result =
    stopped === 0
      ? `ESPN didn't move ${name(plan.ir!.move.playerId)} to IR. Nothing else was sent.`
      : stopped === 1
        ? `ESPN didn't add ${add}.${plan.ir ? ` ${name(plan.ir.move.playerId)} is on IR now.` : ""}`
        : `${add} is on your team, but ESPN didn't start him at ${slot}. Start him from your lineup.`;
  return { landed: false, result, steps, details };
}

/** A proposal, or an answer to a pending trade, against the season view, for the confirm sheet. */
export function tradeDryRun(view: SeasonView, body: TradeBody, now: number): TeamDryRun {
  const name = namer(view);
  const team = (id: number) => view.teams.find((t) => t.id === id)?.name ?? "that team";
  if (body.kind === "propose") {
    const drops = body.drops.length ? `, and drop ${list(body.drops, name)} to make room if they accept` : "";
    return {
      text: `Offer ${team(body.partner)} this trade on ESPN? You send ${list(body.gives, name) || "nothing"} and get ${list(body.gets, name) || "nothing"}${drops}.`,
      problems: checkProposal(view.teams, view, { teamA: view.myTeamId, gives: body.gives, teamB: body.partner, gets: body.gets }, body.drops, now),
    };
  }
  const trade = view.pendingTrades.find((t) => t.id === body.tradeId);
  const problems = checkResponse(view.pendingTrades, view.teams, view, view.myTeamId, body.tradeId, body.action, now);
  if (!trade) return { text: "This offer isn't open on ESPN any more.", problems };
  const partner = team(trade.proposerTeamId === view.myTeamId ? trade.partnerTeamId : trade.proposerTeamId);
  const gives = trade.moves.filter((m) => m.fromTeamId === view.myTeamId).map((m) => m.playerId);
  const gets = trade.moves.filter((m) => m.toTeamId === view.myTeamId).map((m) => m.playerId);
  const text =
    body.action === "accept"
      ? `Accept on ESPN? You get ${list(gets, name) || "nothing"} and send ${list(gives, name) || "nothing"}. It goes through after the league's review.`
      : body.action === "decline"
        ? `Decline ${partner}'s offer on ESPN?`
        : `Withdraw your offer to ${partner} on ESPN?`;
  return { text, problems };
}

export function tradeApplied(view: SeasonView, body: TradeBody, landed: TradeResult): TeamApplied {
  if ("pending" in landed) {
    const partner = body.kind === "propose" ? (view.teams.find((t) => t.id === body.partner)?.name ?? "them") : "them";
    return { ...landed, landed: landed.pending, result: landed.pending ? `Offer sent to ${partner}. It's in Pending on ESPN.` : "ESPN doesn't show your offer. Check ESPN. Draft Room has been alerted." };
  }
  const past = body.kind === "respond" && body.action === "accept" ? "accepted. It's in the league's review" : body.kind === "respond" && body.action === "decline" ? "declined" : "withdrawn";
  return { ...landed, landed: landed.done, result: landed.done ? `Offer ${past}.` : "ESPN doesn't show that change. Check ESPN. Draft Room has been alerted." };
}
