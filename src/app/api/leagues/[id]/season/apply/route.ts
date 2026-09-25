import { config } from "@/lib/config";
import { ESPN_LINEUP_WRITE_DISCLOSURE, ESPN_LINEUP_WRITE_VERSION } from "@/lib/espn/disclosure";
import { espnRefusal } from "@/lib/season/apply";
import type { LineupMove } from "@/lib/season/lineup";
import type { LineupSlot } from "@/lib/season/types";
import { withUser } from "@/lib/server/api";
import { formatServerError } from "@/lib/server/errorLog";
import { applyLineup, type ApplyRequest } from "@/lib/server/espn/applyLineup";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { agreeToLineupWrites, lineupWriteConsent } from "@/lib/server/seasonPrefs";

type Ctx = RouteContext<"/api/leagues/[id]/season/apply">;

const ROUTE = "/api/leagues/[id]/season/apply";

const SLOTS = new Set<LineupSlot>(["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "DST", "K", "BN", "IR"]);
const isSlot = (v: unknown): v is LineupSlot => typeof v === "string" && SLOTS.has(v as LineupSlot);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parse(body: unknown): (ApplyRequest & { consentVersion: number | null }) | null {
  if (!isObject(body) || !Number.isInteger(body.week) || !Array.isArray(body.snapshot) || !Array.isArray(body.moves)) return null;
  if (body.snapshot.length > 100 || body.moves.length > 40) return null;
  const snapshot = body.snapshot.flatMap((p) => (isObject(p) && Number.isInteger(p.playerId) && isSlot(p.slot) ? [{ playerId: p.playerId as number, slot: p.slot }] : []));
  const moves: LineupMove[] = body.moves.flatMap((m) =>
    isObject(m) && Number.isInteger(m.playerId) && isSlot(m.from) && isSlot(m.to) ? [{ playerId: m.playerId as number, from: m.from, to: m.to }] : [],
  );
  if (snapshot.length !== body.snapshot.length || moves.length !== body.moves.length) return null;
  const consentVersion = Number.isInteger(body.consentVersion) ? (body.consentVersion as number) : null;
  return { week: body.week as number, snapshot, moves, consentVersion };
}

/**
 * POST /api/leagues/:id/season/apply { week, snapshot, moves, consentVersion? } → { moves }: sets the
 * user's lineup on ESPN (12.1), in one transaction, after re-reading the roster. `snapshot` is the
 * roster as the user staged against, `moves` what they reviewed and confirmed. The answer lists each
 * move with `landed`, from a re-read after writing.
 *
 * - 409 `{ consent }` until the user has agreed to the current consent line; sending its
 *   `consentVersion` agrees.
 * - 409 `{ changed }` when ESPN changed since staging, `{ problems }` when the moves fail the checks
 *   against the fresh roster (a player now locked), `{ refused }` when ESPN said no, and
 *   `{ problem }` when ESPN can't be read. Nothing landed in any of these.
 * - 502 `{ unverified: true }` when the write went out and ESPN couldn't be read after it.
 *
 * ESPN refusing, a write that fails, and moves that didn't land all log [server-error].
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
    if (((await lineupWriteConsent(db, userId)) ?? 0) < ESPN_LINEUP_WRITE_VERSION) {
      if (body.consentVersion !== ESPN_LINEUP_WRITE_VERSION) return json(409, { error: "Agree to War Room changing your ESPN lineup first", consent: { version: ESPN_LINEUP_WRITE_VERSION, lines: ESPN_LINEUP_WRITE_DISCLOSURE } });
      await agreeToLineupWrites(db, userId, ESPN_LINEUP_WRITE_VERSION);
    }

    const out = await applyLineup(db, config.espnCodeKey, userId, id, body);
    switch (out.kind) {
      case "applied": {
        const missed = out.moves.filter((m) => !m.landed);
        if (missed.length) alert(`ESPN lineup apply: ${missed.length} of ${out.moves.length} moves didn't land (${missed.map((m) => `${m.playerId} ${m.from}->${m.to}`).join(", ")})`);
        return json(200, { moves: out.moves });
      }
      case "unverified":
        alert(`ESPN lineup apply unverified: ${out.detail}`);
        return json(502, { error: "War Room sent your moves, but couldn't read ESPN back to check them. Check your lineup on ESPN.", unverified: true, moves: out.moves });
      case "changed":
        return json(409, { error: "Your team changed on ESPN since this page loaded. Nothing was sent.", changed: out.changes });
      case "refused":
        return json(409, { error: "These moves can't be made on ESPN. Nothing was sent.", problems: out.problems });
      case "espn-refused":
        alert(`ESPN refused a lineup apply: ${out.detail}`);
        return json(409, { error: "ESPN refused the moves. Nothing changed.", refused: out.errors.length ? out.errors.map((e) => espnRefusal(e.type, e.message)) : ["ESPN didn't say why."] });
      case "write-failed":
        alert(`ESPN lineup apply failed: ${out.detail}`);
        return error(502, "ESPN didn't take the moves just now, and nothing changed. Try again in a minute.");
      case "problem":
        return json(409, { error: PROBLEM[out.problem], problem: out.problem });
    }
  } catch (err) {
    console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
    return error(503, "Setting your lineup on ESPN is temporarily unavailable");
  }
});

const PROBLEM: Record<string, string> = {
  "not-linked": "This league isn't connected to ESPN.",
  "no-login": "War Room needs your ESPN connection again. Nothing was sent.",
  disconnected: "ESPN signed War Room out. Reconnect with the bookmarklet, then try again. Nothing was sent.",
  unavailable: "Couldn't reach ESPN to check your roster first, so nothing was sent. Try again in a minute.",
  invalid: "ESPN sent something War Room couldn't read, so nothing was sent.",
};
