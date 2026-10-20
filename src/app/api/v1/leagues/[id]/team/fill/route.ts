import { config } from "@/lib/config";
import { fillPlan } from "@/lib/season/holeFill";
import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { stepLanded, writeFill, type FillStepRun } from "@/lib/server/espn/fillWrite";
import type { GuardedOutcome } from "@/lib/server/espn/guardedWrite";
import { isObject, isSlot, readSnapshot } from "@/lib/server/espn/lineupWrite";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { loadFills } from "@/lib/server/espn/waivers";
import { consentGate, consentOf, writeResponse } from "@/lib/server/espn/writeRoute";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { fillApplied, fillDryRun, staleAgainst } from "@/lib/server/v1/team";

type Ctx = RouteContext<"/api/v1/leagues/[id]/team/fill">;

const ROUTE = "/api/v1/leagues/[id]/team/fill";

function parse(body: unknown) {
  if (!isObject(body) || !Number.isInteger(body.week) || !Number.isInteger(body.season) || !Number.isInteger(body.add) || !isObject(body.hole)) return null;
  const { key, playerId } = body.hole;
  if (!isSlot(key) || !(playerId === null || Number.isInteger(playerId))) return null;
  const snapshot = readSnapshot(body.snapshot);
  if (!snapshot) return null;
  return { week: body.week as number, season: body.season as number, snapshot, hole: { key: key as string, playerId: playerId as number | null }, add: body.add as number, consentVersion: consentOf(body) };
}

/** A step's outcome as a guarded write's, for writeResponse(). */
const guarded = (run: FillStepRun): GuardedOutcome<unknown> => (run.step !== "add" && run.out.kind === "applied" ? { kind: "applied", landed: run.out.moves } : (run.out as GuardedOutcome<unknown>));

/**
 * POST /api/v1/leagues/:id/team/fill[?dryRun=1] { week, season, snapshot, hole: { key, playerId }, add, consentVersion? }
 *
 * Fills a hole in this week's lineup from the iPhone app (APE-404), as the web's hole card does: the
 * hole's player to IR when that makes room, the add with its drop, then the start (fillPlan() in
 * src/lib/season/holeFill.ts). `hole` and `add` pick one of team/fills' ways to fill it; the server
 * takes its drop and IR from there, so the app can't send a different one.
 *
 * - `?dryRun=1` → FillDryRun (src/lib/server/v1/team.ts): the fill and each step in plain words, and
 *   why it can't go. Nothing is written and no consent is needed.
 * - Otherwise each step is its own guarded write, in order, and one that doesn't land stops the
 *   fill. When the first step doesn't go, the answer is the usual refusal (writeRoute.ts). Once a
 *   step has been sent → FillApplied: each step and whether it landed, in the web's words.
 *
 * 409 `{ changed }` when the way to fill it is no longer on offer: the app reads team/fills again.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  const { id } = await ctx.params;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parse(read.body);
  if (!body) return error(400, "Invalid request");
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const key = config.espnCodeKey!;
  const where = { method: request.method, path: new URL(request.url).pathname };
  const failed = (err: unknown) => console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
  const alert = (message: string) => failed(new Error(message));
  const refuse = (out: GuardedOutcome<never>) => writeResponse(out, { what: "hole fill", alert, applied: (landed) => landed });

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    if (!dryRun) {
      const gate = await consentGate(db, userId, body.consentVersion);
      if (gate) return gate;
    }

    const load = await loadSeasonView(db, key, userId, id);
    if (load.kind !== "ok") return refuse({ kind: "problem", problem: load.kind });
    const { view } = load;
    const stale = staleAgainst(view, body.week, body.snapshot);
    if (stale) return refuse(stale);

    const fills = await loadFills(db, key, userId, id);
    if (fills.kind !== "ok") return refuse({ kind: "problem", problem: fills.problem });
    const hole = fills.fills.find((f) => f.hole.key === body.hole.key && f.hole.playerId === body.hole.playerId);
    const fill = hole?.fills.find((f) => f.player.playerId === body.add);
    const plan = hole && fill && fillPlan(view, hole.hole, fill);
    if (!hole || !fill || !plan) return refuse({ kind: "changed", changes: ["The ways to fill this hole have changed. Look again and pick one."] });
    if (dryRun) return json(200, fillDryRun(view, hole.hole, fill, plan));

    const ran = await writeFill(db, key, userId, id, { week: body.week, season: body.season, plan }, { alert, failed });
    const last = ran[ran.length - 1];
    // Nothing went to ESPN: the first step's refusal, as any write's.
    if (ran.length === 1 && last.out.kind !== "applied") return writeResponse(guarded(last), { what: `hole fill ${last.step}`, alert, applied: () => error(500, "unreachable") });

    let details: string[] = [];
    if (!stepLanded(last) && last.out.kind !== "applied") {
      const answer = (await writeResponse(guarded(last), { what: `hole fill ${last.step}`, alert, applied: () => json(200, {}) }).json()) as { error?: string; changed?: string[]; problems?: string[]; refused?: string[] };
      const why = answer.changed ?? answer.problems ?? answer.refused ?? [];
      details = why.length ? why : answer.error ? [answer.error] : [];
    }
    return json(200, fillApplied(view, hole.hole, fill, plan, ran.map(stepLanded), details));
  } catch (err) {
    failed(err);
    return error(503, "Filling the hole on ESPN is temporarily unavailable");
  }
});
