import { evaluateTrade } from "@/lib/season/trade";
import type { IdeaKind, TradeCandidate, TradeSearch } from "@/lib/season/tradeIdeas";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { withDeadline } from "../generatePlan";
import { PlanModelError, type JsonSchema, type ModelEffort, type ModelUsage, type PlanModel } from "../provider";
import { clip, injuryTag, isObject, refError } from "./shared";
import { byes, changedSlots, playoffPoints, round, slotText, standingOf, type TradeInputSide } from "./trade";

/**
 * Trade ideas, written up (APE-222). The search in `lib/season/tradeIdeas.ts` has already found and
 * graded the candidates: safe ones, where the partner doesn't lose, and bold ones, where they lose a
 * little. The model picks one of each, says why, and drafts a note the user can send the partner.
 * It picks by id from the engine's lists, so it can't invent a trade or change its numbers.
 */

/** Bump when the prompt or the input it's built from changes meaningfully. Recorded with each set. */
export const TRADE_IDEAS_PROMPT_VERSION = 1;

export interface TradeIdea {
  kind: IdeaKind;
  partner: number;
  gives: number[];
  gets: number[];
  /** The engine's grade when the idea was found, per remaining week. The page grades it again live. */
  found: { you: number; them: number; weeks: number };
  /** Why this trade, to the user. */
  why: string;
  /** A note the user could send the partner. ESPN's trade offer has no message field, so it's copied. */
  pitch: string;
  /** Who moves, by id, so the card can still name a player who has since left either roster. */
  names: Record<number, string>;
}

export interface AiTradeIdeas {
  /** At most one of each kind, safe first. */
  ideas: TradeIdea[];
  /** Kinds the search found nothing for. */
  missing: IdeaKind[];
}

export interface IdeaInputPlayer {
  ref: string;
  playerId: number;
  name: string;
  pos: ViewPlayer["pos"];
  team: string | null;
  ros: number;
  playoffs: number | null;
  byes: number[];
  injury: string | null;
}

export interface IdeaInputCandidate {
  id: string;
  kind: IdeaKind;
  partner: { id: number; name: string; standing: TradeInputSide["standing"] };
  send: string[];
  get: string[];
  you: { perWeek: number; total: number; slots: TradeInputSide["slots"]; drops: string[] };
  them: { perWeek: number; total: number; slots: TradeInputSide["slots"]; drops: string[] };
  /** The engine's candidate, for mapping a pick back. Not shown to the model. */
  candidate: TradeCandidate;
}

export interface TradeIdeasInput {
  season: number;
  week: number;
  finalWeek: number;
  playoffStartWeek: number | null;
  weeks: number;
  teams: number;
  me: { name: string; standing: TradeInputSide["standing"] };
  candidates: IdeaInputCandidate[];
  /** The user's roster, then every other player in a candidate. */
  players: (IdeaInputPlayer & { mine: boolean })[];
}

/** The model's input: each candidate with both sides' grades, the user's roster, and everyone moving. */
export function buildTradeIdeasInput(view: SeasonView, search: Pick<TradeSearch, "safe" | "bold">): TradeIdeasInput {
  const mine = view.teams.find((t) => t.id === view.myTeamId)!;
  const everyone = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p] as const)));
  const listed = [...search.safe, ...search.bold];
  const moving = new Set(listed.flatMap((c) => c.trade.gets));
  const players = [...mine.roster.map((p) => ({ p, mine: true })), ...[...moving].map((id) => ({ p: everyone.get(id)!, mine: false }))];
  const refOf = new Map(players.map(({ p }, i) => [p.playerId, `p${i + 1}`]));
  const refs = (list: readonly number[]) => list.map((id) => refOf.get(id)!);
  // A partner's drops are their own players, who aren't in the table; they're named outright.
  const named = (list: readonly number[]) => list.map((id) => refOf.get(id) ?? everyone.get(id)?.name ?? `player ${id}`);

  const candidates = (["safe", "bold"] as const).flatMap((kind) =>
    search[kind].map((c, i): IdeaInputCandidate => {
      const partner = view.teams.find((t) => t.id === c.trade.teamB)!;
      const verdict = evaluateTrade(view.teams, view, c.trade)!;
      return {
        id: `${kind[0]}${i + 1}`,
        kind,
        partner: { id: partner.id, name: partner.name, standing: standingOf(partner.standing) },
        send: refs(c.trade.gives),
        get: refs(c.trade.gets),
        you: { perWeek: round(verdict.a.perWeek), total: round(verdict.a.delta), slots: changedSlots(verdict.a), drops: named(verdict.a.drops) },
        them: { perWeek: round(verdict.b.perWeek), total: round(verdict.b.delta), slots: changedSlots(verdict.b), drops: named(verdict.b.drops) },
        candidate: c,
      };
    }),
  );
  return {
    season: view.season,
    week: view.currentWeek,
    finalWeek: view.finalWeek,
    playoffStartWeek: view.playoffStartWeek,
    weeks: Math.max(0, view.finalWeek - view.currentWeek + 1),
    teams: view.teams.length,
    me: { name: mine.name, standing: standingOf(mine.standing) },
    candidates,
    players: players.map(({ p, mine }) => ({
      ref: refOf.get(p.playerId)!,
      playerId: p.playerId,
      name: p.name,
      pos: p.pos,
      team: p.team,
      ros: round(p.ros),
      playoffs: playoffPoints(view, p),
      byes: byes(p),
      injury: injuryTag(p.injuryStatus),
      mine,
    })),
  };
}

export const TRADE_IDEAS_SYSTEM_PROMPT = `You are a fantasy football analyst finding trades for one manager. A trade engine has already searched every roster in the league and graded each candidate: for each team, the best legal starting lineup's projected points for every remaining week, before and after. Those numbers are settled; explain them, don't redo or re-rank them.

There are two lists:
- Safe: the manager gains and the partner's lineup doesn't get worse, so the partner has a reason to accept.
- Bold: the manager gains more than any safe idea, and the partner loses a little.

Pick one candidate from each list that has any, weighing:
- the manager's gain, especially in the fantasy playoff weeks, if given;
- byes, injuries and how the moving players' playoff points compare;
- standings, if given: a contender should weigh this season's points; a struggling team may want playoff-week strength only if it can still get in;
- how likely the partner is to say yes: their own gain or loss, and whether it fills a hole for them.

Output rules:
- pick: the candidate's id, such as s2 or b1, from that list. An empty string only when that list is empty.
- why: 1-2 sentences to the manager, naming the number that drives the pick.
- pitch: 1-2 friendly sentences the manager could send the partner, selling the trade from the partner's side. Be honest: never claim it helps them when their number is negative, and don't quote the engine's numbers to them.
- Text names players, never refs or ids.
- Everything must come from the tables: no outside news, injuries, depth charts, schedules or team situations beyond what's listed.`;

export function buildTradeIdeasPrompt(input: TradeIdeasInput): { system: string; user: string } {
  const playoffs = input.playoffStartWeek === null ? "Playoff weeks unknown." : `Playoffs: weeks ${input.playoffStartWeek}-${input.finalWeek}.`;
  const name = new Map(input.players.map((p) => [p.ref, `${p.name} [${p.ref}]`]));
  const people = (list: readonly string[]) => list.map((r) => name.get(r) ?? r).join(", ");
  const standing = (s: TradeInputSide["standing"]) => (s ? `${s.record}, ${s.pointsFor} points for${s.seed ? `, seed ${s.seed}` : ""}` : "standing unknown");
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
  const side = (label: string, s: IdeaInputCandidate["you"]) => [
    `  ${label}: ${signed(s.perWeek)} a week (${signed(s.total)} total); slots per week: ${s.slots.map(slotText).join(", ") || "no change"}`,
    ...(s.drops.length ? [`    would cut to fit the roster: ${people(s.drops)}`] : []),
  ];
  const candidate = (c: IdeaInputCandidate) => [
    `### ${c.id}: with ${c.partner.name} (${standing(c.partner.standing)})`,
    `  you send ${people(c.send)}; you get ${people(c.get)}`,
    ...side("You", c.you),
    ...side("Them", c.them),
  ];
  const row = (p: IdeaInputPlayer) =>
    [
      `[${p.ref}] ${p.name}, ${p.pos} ${p.team ?? "FA"}`,
      `ROS ${p.ros}`,
      ...(p.playoffs === null ? [] : [`playoffs ${p.playoffs}`]),
      `bye ${p.byes.length ? p.byes.join("/") : "-"}`,
      p.injury ?? "-",
    ].join(" | ");
  const list = (kind: IdeaKind) => input.candidates.filter((c) => c.kind === kind);
  const lines = [
    `${input.season}, week ${input.week}; ${input.weeks} weeks left through week ${input.finalWeek}. ${playoffs} ${input.teams} teams.`,
    `The manager: ${input.me.name}, ${standing(input.me.standing)}.`,
    "",
    "## Candidates",
    "Safe:",
    ...(list("safe").length ? list("safe").flatMap(candidate) : ["  none"]),
    "Bold:",
    ...(list("bold").length ? list("bold").flatMap(candidate) : ["  none"]),
    "",
    "Players: [ref] name, position team | rest-of-season points | playoff-week points | bye weeks left | injury",
    "## Your roster",
    ...input.players.filter((p) => p.mine).map(row),
    "## Players you'd get",
    ...input.players.filter((p) => !p.mine).map(row),
  ];
  return { system: TRADE_IDEAS_SYSTEM_PROMPT, user: lines.join("\n") };
}

const choice = {
  type: "object",
  additionalProperties: false,
  required: ["pick", "why", "pitch"],
  properties: { pick: { type: "string", description: "A candidate id such as s1 or b2, or empty when the list is empty." }, why: { type: "string" }, pitch: { type: "string" } },
};

export const TRADE_IDEAS_OUTPUT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["safe", "bold"],
  properties: { safe: choice, bold: choice },
};

const LIMITS = { why: 400, pitch: 300 };

export type TradeIdeasValidation = { ok: true; ideas: AiTradeIdeas; issues: string[] } | { ok: false; issues: string[] };

/**
 * Checks a model response against its input. A pick that isn't a candidate, or comes from the other
 * list, rejects the response, as does a list with candidates and no pick or no reason. The picks map
 * back to the engine's own trades, so the players and numbers are the engine's.
 */
export function validateTradeIdeas(raw: unknown, input: TradeIdeasInput): TradeIdeasValidation {
  if (!isObject(raw)) return { ok: false, issues: ["response is not a set of trade ideas"] };
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const nameOf = new Map(input.players.map((p) => [p.playerId, p.name]));
  const ideas: TradeIdea[] = [];
  const missing: IdeaKind[] = [];
  const issues: string[] = [];
  for (const kind of ["safe", "bold"] as const) {
    const offered = input.candidates.some((c) => c.kind === kind);
    const answer = isObject(raw[kind]) ? raw[kind] : {};
    const pick = typeof answer.pick === "string" ? answer.pick.trim() : "";
    if (!offered) {
      missing.push(kind);
      if (pick) issues.push(`ignored a ${kind} pick with no ${kind} candidates`);
      continue;
    }
    if (!pick) return { ok: false, issues: [`no ${kind} pick`] };
    const chosen = byId.get(pick);
    if (!chosen) return { ok: false, issues: [refError(pick)] };
    if (chosen.kind !== kind) return { ok: false, issues: [`picked ${pick} as ${kind}, but it's a ${chosen.kind} candidate`] };
    const why = clip(answer.why, LIMITS.why);
    if (!why) return { ok: false, issues: [`no reason for the ${kind} pick`] };
    const { trade, you, them, weeks } = chosen.candidate;
    const names = Object.fromEntries([...trade.gives, ...trade.gets].map((id) => [id, nameOf.get(id) ?? `ESPN player ${id}`]));
    ideas.push({ kind, partner: trade.teamB, gives: [...trade.gives], gets: [...trade.gets], found: { you: round(you), them: round(them), weeks }, why, pitch: clip(answer.pitch, LIMITS.pitch), names });
  }
  return { ok: true, ideas: { ideas, missing }, issues };
}

export interface GeneratedTradeIdeas {
  ideas: AiTradeIdeas;
  issues: string[];
  provider: string;
  model: string;
  usage: ModelUsage;
  durationMs: number;
}

const MAX_OUTPUT_TOKENS = 8_000;

/** Throws PlanModelError when the provider fails or the response is unusable. */
export async function generateTradeIdeas(
  model: PlanModel,
  input: TradeIdeasInput,
  { signal, effort = "low" }: { signal?: AbortSignal; effort?: ModelEffort } = {},
): Promise<GeneratedTradeIdeas> {
  const start = performance.now();
  const { system, user } = buildTradeIdeasPrompt(input);
  const call = model.generate({ system, user, schema: TRADE_IDEAS_OUTPUT_SCHEMA, maxTokens: MAX_OUTPUT_TOKENS, effort, signal });
  const { json, usage } = await (signal ? withDeadline(call, signal) : call);
  const result = validateTradeIdeas(json, input);
  if (!result.ok) throw new PlanModelError("invalid_output", `Unusable trade ideas: ${result.issues.join("; ")}`, usage);
  return { ideas: result.ideas, issues: result.issues, provider: model.provider, model: model.model, usage, durationMs: performance.now() - start };
}
