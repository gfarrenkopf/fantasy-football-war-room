import { config } from "@/lib/config";
import type { LineupSlot } from "@/lib/season/types";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { addFreeAgent, cancelClaim, claimWaiver, type AcquireRequest } from "@/lib/server/espn/acquire";
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

type Parsed =
  | ({ kind: "add" } & AcquireRequest)
  | ({ kind: "claim" } & AcquireRequest)
  | { kind: "cancel"; week: number; claimId: string };

function parse(body: unknown): (Parsed & { consentVersion: number | null }) | null {
  if (!isObject(body) || !isId(body.week)) return null;
  const consentVersion = consentOf(body);
  if (body.kind === "cancel") return typeof body.claimId === "string" && /^[\w-]{1,64}$/.test(body.claimId) ? { kind: "cancel", week: body.week, claimId: body.claimId, consentVersion } : null;
  if ((body.kind !== "add" && body.kind !== "claim") || !isId(body.add) || !(body.drop === null || isId(body.drop)) || !Array.isArray(body.snapshot)) return null;
  if (body.snapshot.length > 100) return null;
  const snapshot = body.snapshot.flatMap((p) => (isObject(p) && isId(p.playerId) && isSlot(p.slot) ? [{ playerId: p.playerId, slot: p.slot }] : []));
  if (snapshot.length !== body.snapshot.length) return null;
  const request = { week: body.week, snapshot, add: body.add, drop: body.drop, consentVersion };
  return { kind: body.kind, ...request };
}

/**
 * POST /api/leagues/:id/season/acquire: adds players from ESPN's pool to the user's team (Epic 13),
 * each as one transaction after re-reading the roster, and answers from a re-read after writing.
 *
 * - `{ kind: "add", week, snapshot, add, drop }` → `{ added, dropped }`: a free agent, at once (13.3).
 * - `{ kind: "claim", week, snapshot, add, drop }` → `{ pending }`: a waiver claim (13.4), in leagues
 *   that don't bid FAAB.
 * - `{ kind: "cancel", week, claimId }` → `{ cancelled }`: withdraws a pending claim.
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
  if (!body) return error(400, "Invalid request");
  const where = { method: request.method, path: new URL(request.url).pathname };
  const alert = (message: string) => console.error(formatServerError(new Error(message), where, { routePath: ROUTE, routeType: "route" }));

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    const gate = await consentGate(db, userId, body.consentVersion);
    if (gate) return gate;

    const key = config.espnCodeKey;
    if (body.kind === "cancel") {
      return writeResponse(await cancelClaim(db, key, userId, id, body), {
        what: "claim cancel",
        alert,
        applied: (landed) => {
          if (!landed.cancelled) alert(`ESPN claim cancel didn't land: ${body.claimId} still pending`);
          return json(200, landed);
        },
      });
    }
    if (body.kind === "claim") {
      return writeResponse(await claimWaiver(db, key, userId, id, body), {
        what: "waiver claim",
        alert,
        applied: (landed) => {
          if (!landed.pending) alert(`ESPN waiver claim didn't land: add ${body.add} not pending`);
          return json(200, landed);
        },
      });
    }
    const out = await addFreeAgent(db, key, userId, id, body);
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
    return error(503, "Changing your roster on ESPN is temporarily unavailable");
  }
});
