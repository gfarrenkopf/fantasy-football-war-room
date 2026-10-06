import { config } from "@/lib/config";
import { madeMoves, type SuggestedMove } from "@/lib/season/apply";
import type { LineupMove } from "@/lib/season/lineup";
import type { LineupSlot } from "@/lib/season/types";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { applyLineup, type ApplyRequest } from "@/lib/server/espn/applyLineup";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { consentGate, consentOf, writeResponse } from "@/lib/server/espn/writeRoute";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { recordLineupMoves } from "@/lib/server/lineupMoves";

type Ctx = RouteContext<"/api/leagues/[id]/season/apply">;

const ROUTE = "/api/leagues/[id]/season/apply";

const SLOTS = new Set<LineupSlot>(["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "DST", "K", "BN", "IR"]);
const isSlot = (v: unknown): v is LineupSlot => typeof v === "string" && SLOTS.has(v as LineupSlot);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parse(body: unknown): (ApplyRequest & { consentVersion: number | null; season: number | null; suggested: SuggestedMove[] }) | null {
  if (!isObject(body) || !Number.isInteger(body.week) || !Array.isArray(body.snapshot) || !Array.isArray(body.moves)) return null;
  if (body.snapshot.length > 100 || body.moves.length > 40) return null;
  const snapshot = body.snapshot.flatMap((p) => (isObject(p) && Number.isInteger(p.playerId) && isSlot(p.slot) ? [{ playerId: p.playerId as number, slot: p.slot }] : []));
  const moves: LineupMove[] = body.moves.flatMap((m) =>
    isObject(m) && Number.isInteger(m.playerId) && isSlot(m.from) && isSlot(m.to) ? [{ playerId: m.playerId as number, from: m.from, to: m.to }] : [],
  );
  if (snapshot.length !== body.snapshot.length || moves.length !== body.moves.length) return null;
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
  if (!mayUseSeason(config.espnSyncAllowlist, email)) return error(403, "In-season help isn't available on this account yet");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parse(read.body);
  if (!body) return error(400, "Invalid lineup moves");
  const where = { method: request.method, path: new URL(request.url).pathname };
  const alert = (message: string) => console.error(formatServerError(new Error(message), where, { routePath: ROUTE, routeType: "route" }));

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    const gate = await consentGate(db, userId, body.consentVersion);
    if (gate) return gate;

    const out = await applyLineup(db, config.espnCodeKey, userId, id, body);
    const made = out.kind === "applied" ? madeMoves(out.moves, body.suggested) : [];
    // The lineup is set either way: failing to remember War Room's part mustn't fail the apply.
    if (made.length && body.season !== null)
      await recordLineupMoves(db, id, body.season, body.week, made).catch((err) => console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" })));
    return writeResponse(out.kind === "applied" ? { kind: "applied", landed: out.moves } : out, {
      what: "lineup apply",
      alert,
      unverified: { moves: out.kind === "unverified" ? out.moves : [] },
      applied: (moves) => {
        const missed = moves.filter((m) => !m.landed);
        if (missed.length) alert(`ESPN lineup apply: ${missed.length} of ${moves.length} moves didn't land (${missed.map((m) => `${m.playerId} ${m.from}->${m.to}`).join(", ")})`);
        return json(200, { moves });
      },
    });
  } catch (err) {
    console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
    return error(503, "Setting your lineup on ESPN is temporarily unavailable");
  }
});

