import { config } from "@/lib/config";
import type { LineupSlot } from "@/lib/season/types";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { addFreeAgent, type AcquireRequest } from "@/lib/server/espn/acquire";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { forgetWaivers } from "@/lib/server/espn/waivers";
import { consentGate, consentOf, writeResponse } from "@/lib/server/espn/writeRoute";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/season/acquire">;

const ROUTE = "/api/leagues/[id]/season/acquire";

const SLOTS = new Set<LineupSlot>(["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "DST", "K", "BN", "IR"]);
const isSlot = (v: unknown): v is LineupSlot => typeof v === "string" && SLOTS.has(v as LineupSlot);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isId = (v: unknown): v is number => Number.isInteger(v);

function parse(body: unknown): (AcquireRequest & { consentVersion: number | null }) | null {
  if (!isObject(body) || body.kind !== "add" || !isId(body.week) || !isId(body.add) || !(body.drop === null || isId(body.drop)) || !Array.isArray(body.snapshot)) return null;
  if (body.snapshot.length > 100) return null;
  const snapshot = body.snapshot.flatMap((p) => (isObject(p) && isId(p.playerId) && isSlot(p.slot) ? [{ playerId: p.playerId, slot: p.slot }] : []));
  if (snapshot.length !== body.snapshot.length) return null;
  return { week: body.week, snapshot, add: body.add, drop: body.drop, consentVersion: consentOf(body) };
}

/**
 * POST /api/leagues/:id/season/acquire { kind: "add", week, snapshot, add, drop, consentVersion? }
 * → { added, dropped }: adds a free agent to the user's ESPN team (13.3), dropping `drop` (or no one,
 * when the roster has room), in one transaction after re-reading the roster. The answer comes from a
 * re-read after writing. Consent, aborts and failures answer as every ESPN write does
 * (src/lib/server/espn/writeRoute.ts); an add that didn't land also logs [server-error].
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!mayUseSeason(config.espnSyncAllowlist, email)) return error(403, "In-season help isn't available on this account yet");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parse(read.body);
  if (!body) return error(400, "Invalid add");
  const where = { method: request.method, path: new URL(request.url).pathname };
  const alert = (message: string) => console.error(formatServerError(new Error(message), where, { routePath: ROUTE, routeType: "route" }));

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    const gate = await consentGate(db, userId, body.consentVersion);
    if (gate) return gate;

    const out = await addFreeAgent(db, config.espnCodeKey, userId, id, body);
    if (out.kind === "applied" || out.kind === "unverified") forgetWaivers(userId, id);
    return writeResponse(out, {
      what: "free-agent add",
      alert,
      applied: (landed) => {
        if (!landed.added || !landed.dropped) alert(`ESPN free-agent add didn't land: add ${body.add} ${landed.added ? "in" : "missing"}, drop ${body.drop} ${landed.dropped ? "gone" : "still there"}`);
        return json(200, landed);
      },
    });
  } catch (err) {
    console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
    return error(503, "Adding players on ESPN is temporarily unavailable");
  }
});
