import { config } from "@/lib/config";
import type { LineupSlot } from "@/lib/season/types";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { proposeTrade, respondToTrade, type ProposeRequest, type RespondRequest } from "@/lib/server/espn/trades";
import { consentGate, consentOf, writeResponse } from "@/lib/server/espn/writeRoute";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/season/trades">;

const ROUTE = "/api/leagues/[id]/season/trades";

const SLOTS = new Set<LineupSlot>(["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "DST", "K", "BN", "IR"]);
const isSlot = (v: unknown): v is LineupSlot => typeof v === "string" && SLOTS.has(v as LineupSlot);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isId = (v: unknown): v is number => Number.isInteger(v);
const ids = (v: unknown, max: number): number[] | null => (Array.isArray(v) && v.length <= max && v.every(isId) ? v : null);

function snapshotOf(v: unknown) {
  if (!Array.isArray(v) || v.length > 100) return null;
  const snapshot = v.flatMap((p) => (isObject(p) && isId(p.playerId) && isSlot(p.slot) ? [{ playerId: p.playerId, slot: p.slot }] : []));
  return snapshot.length === v.length ? snapshot : null;
}

type Parsed = ({ kind: "propose" } & ProposeRequest) | ({ kind: "respond" } & RespondRequest);

function parse(body: unknown): (Parsed & { consentVersion: number | null }) | null {
  if (!isObject(body) || !isId(body.week)) return null;
  const consentVersion = consentOf(body);
  if (body.kind === "propose") {
    const snapshot = snapshotOf(body.snapshot);
    const gives = ids(body.gives, 20);
    const gets = ids(body.gets, 20);
    const drops = ids(body.drops ?? [], 10);
    if (!snapshot || !gives || !gets || !drops || !isId(body.partner)) return null;
    return { kind: "propose", week: body.week, snapshot, partner: body.partner, gives, gets, drops, consentVersion };
  }
  if ((body.kind === "accept" || body.kind === "decline" || body.kind === "withdraw") && typeof body.tradeId === "string" && /^[\w-]{1,64}$/.test(body.tradeId)) {
    const snapshot = body.kind === "accept" ? snapshotOf(body.snapshot) : null;
    if (body.kind === "accept" && !snapshot) return null;
    return { kind: "respond", action: body.kind, week: body.week, snapshot, tradeId: body.tradeId, consentVersion };
  }
  return null;
}

/**
 * POST /api/leagues/:id/season/trades: trades on ESPN for the user's own team (13.5), each one
 * transaction after re-reading the league, answered from a re-read after writing.
 *
 * - `{ kind: "propose", week, snapshot, partner, gives, gets, drops }` → `{ pending }`.
 * - `{ kind: "accept", week, snapshot, tradeId }` / `{ kind: "decline" | "withdraw", week, tradeId }`
 *   → `{ done }`: accepted (now in review), declined, or withdrawn.
 *
 * Every kind takes `consentVersion?`. Consent, aborts and failures answer as every ESPN write does
 * (src/lib/server/espn/writeRoute.ts); a write that didn't land also logs [server-error].
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!mayUseSeason(config.espnSyncAllowlist, email)) return error(403, "In-season help isn't available on this account yet");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parse(read.body);
  if (!body) return error(400, "Invalid trade");
  const where = { method: request.method, path: new URL(request.url).pathname };
  const alert = (message: string) => console.error(formatServerError(new Error(message), where, { routePath: ROUTE, routeType: "route" }));

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    const gate = await consentGate(db, userId, body.consentVersion);
    if (gate) return gate;

    if (body.kind === "propose") {
      return writeResponse(await proposeTrade(db, config.espnCodeKey, userId, id, body), {
        what: "trade proposal",
        alert,
        applied: (landed) => {
          if (!landed.pending) alert(`ESPN trade proposal didn't land: not pending after writing (partner ${body.partner})`);
          return json(200, landed);
        },
      });
    }
    return writeResponse(await respondToTrade(db, config.espnCodeKey, userId, id, body), {
      what: `trade ${body.action}`,
      alert,
      applied: (landed) => {
        if (!landed.done) alert(`ESPN trade ${body.action} didn't land: ${body.tradeId}`);
        return json(200, landed);
      },
    });
  } catch (err) {
    console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
    return error(503, "Trading on ESPN is temporarily unavailable");
  }
});
