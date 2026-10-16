import { config } from "@/lib/config";
import type { LineupMove } from "@/lib/season/lineup";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { mayUseSeason } from "@/lib/server/espn/access";
import { isObject, isSlot, readSnapshot, writeLineup, type LineupWrite } from "@/lib/server/espn/lineupWrite";
import { consentGate, consentOf, writeResponse } from "@/lib/server/espn/writeRoute";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

type Ctx = RouteContext<"/api/leagues/[id]/season/apply">;

const ROUTE = "/api/leagues/[id]/season/apply";

function parse(body: unknown): (LineupWrite & { consentVersion: number | null }) | null {
  if (!isObject(body) || !Number.isInteger(body.week) || !Array.isArray(body.moves) || body.moves.length > 40) return null;
  const snapshot = readSnapshot(body.snapshot);
  const moves: LineupMove[] = body.moves.flatMap((m) =>
    isObject(m) && Number.isInteger(m.playerId) && isSlot(m.from) && isSlot(m.to) ? [{ playerId: m.playerId as number, from: m.from, to: m.to }] : [],
  );
  if (!snapshot || moves.length !== body.moves.length) return null;
  const listed = Array.isArray(body.suggested) ? body.suggested.slice(0, 40) : [];
  const suggested = listed.flatMap((m) =>
    isObject(m) && Number.isInteger(m.playerId) && isSlot(m.to) && typeof m.gain === "number" && Number.isFinite(m.gain) ? [{ playerId: m.playerId as number, to: m.to, gain: m.gain }] : [],
  );
  const season = Number.isInteger(body.season) ? (body.season as number) : null;
  return { week: body.week as number, snapshot, moves, consentVersion: consentOf(body), season, suggested };
}

/**
 * POST /api/leagues/:id/season/apply { week, snapshot, moves, consentVersion?, season?, suggested? } → { moves }:
 * sets the user's lineup on ESPN (12.1), in one transaction, after re-reading the roster. `snapshot`
 * is the roster as the user staged against, `moves` what they reviewed and confirmed. The answer lists
 * each move with `landed`, from a re-read after writing. `suggested` names the moves War Room
 * suggested; those that landed are kept for the lineup and recaps (APE-256).
 *
 * Consent, aborts and failures answer as every ESPN write does (src/lib/server/espn/writeRoute.ts).
 * Moves that didn't land also log [server-error].
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const { id } = await ctx.params;
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!(await mayUseSeason(db, userId, email))) return error(403, "In-season help isn't available on this account yet");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parse(read.body);
  if (!body) return error(400, "Invalid lineup moves");
  const where = { method: request.method, path: new URL(request.url).pathname };
  const failed = (err: unknown) => console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
  const alert = (message: string) => failed(new Error(message));

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    const gate = await consentGate(db, userId, body.consentVersion);
    if (gate) return gate;

    const out = await writeLineup(db, config.espnCodeKey, userId, id, body, { alert, failed });
    return writeResponse(out.kind === "applied" ? { kind: "applied", landed: out.moves } : out, {
      what: "lineup apply",
      alert,
      unverified: { moves: out.kind === "unverified" ? out.moves : [] },
      applied: (moves) => json(200, { moves }),
    });
  } catch (err) {
    failed(err);
    return error(503, "Setting your lineup on ESPN is temporarily unavailable");
  }
});

