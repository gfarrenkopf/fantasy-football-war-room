import { config } from "@/lib/config";
import { rosterChanges, type RosterSnapshot } from "@/lib/season/apply";
import { lineupTarget } from "@/lib/season/lineupTarget";
import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { isObject, readSnapshot, writeLineup } from "@/lib/server/espn/lineupWrite";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import type { GuardedOutcome } from "@/lib/server/espn/guardedWrite";
import { consentGate, consentOf, writeResponse } from "@/lib/server/espn/writeRoute";
import { formatServerError } from "@/lib/server/errorLog";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { appliedResponse, dryRunResponse } from "@/lib/server/v1/lineup";

type Ctx = RouteContext<"/api/v1/leagues/[id]/lineup">;

const ROUTE = "/api/v1/leagues/[id]/lineup";

interface Body {
  week: number;
  season: number;
  snapshot: RosterSnapshot;
  lineup: (number | null)[];
  /** Everyone who should be on IR (APE-386); left out, IR stays as it is. */
  ir?: number[];
  changes?: string[];
  consentVersion: number | null;
}

function parse(body: unknown): Body | null {
  if (!isObject(body) || !Number.isInteger(body.week) || !Number.isInteger(body.season)) return null;
  const snapshot = readSnapshot(body.snapshot);
  if (!snapshot || !Array.isArray(body.lineup) || body.lineup.length > 30) return null;
  if (!body.lineup.every((id) => id === null || Number.isInteger(id))) return null;
  if (body.ir !== undefined && !(Array.isArray(body.ir) && body.ir.length <= 20 && body.ir.every((id) => Number.isInteger(id)))) return null;
  if (body.changes !== undefined && !(Array.isArray(body.changes) && body.changes.length <= 40 && body.changes.every((c) => typeof c === "string"))) return null;
  return {
    week: body.week as number,
    season: body.season as number,
    snapshot,
    lineup: body.lineup as (number | null)[],
    ir: body.ir as number[] | undefined,
    changes: body.changes as string[] | undefined,
    consentVersion: consentOf(body),
  };
}

/**
 * POST /api/v1/leagues/:id/lineup[?dryRun=1] { week, season, snapshot, lineup, ir?, changes?, consentVersion? }
 *
 * Sets the user's lineup on ESPN from the iPhone app (APE-381). The app sends the lineup it wants,
 * seat for seat with the season response's `lineup.seats` (null for an empty seat; anyone not named
 * goes to the bench), and the roster it staged against as `snapshot`; the server works out the moves.
 * `ir` names everyone who should be on IR, as the web's IR picker does (APE-386): moving a player on
 * or off IR is a change like any other. Left out, IR stays as it is.
 *
 * - `?dryRun=1` → LineupDryRun (src/lib/server/v1/lineup.ts): each change in plain words with an id,
 *   and any problems. Nothing is written and no consent is needed.
 * - Otherwise `changes` names the ids to make (all when left out) → LineupApplied: each change sent,
 *   and whether it landed. The write is the web apply route's (writeLineup()): the consent gate, a
 *   fresh re-read, one transaction, a re-read after, and War Room's moves kept.
 *
 * Every refusal answers as the web's ESPN writes do (src/lib/server/espn/writeRoute.ts): 409
 * `{ consent }`, `{ changed }`, `{ problems }`, `{ refused }` or `{ problem }`, and 502 `{ unverified }`.
 * 400 when the lineup doesn't fit the league's seats or a change id isn't one of this lineup's.
 */
export const POST = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  const { id } = await ctx.params;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const body = parse(read.body);
  if (!body) return error(400, "Invalid lineup");
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const key = config.espnCodeKey!;
  const where = { method: request.method, path: new URL(request.url).pathname };
  const failed = (err: unknown) => console.error(formatServerError(err, where, { routePath: ROUTE, routeType: "route" }));
  const alert = (message: string) => failed(new Error(message));
  /** Answers a lineup that can't go to ESPN as the write would have. */
  const refuse = (out: GuardedOutcome<never>) => writeResponse(out, { what: "lineup apply", alert, applied: (landed) => landed });

  try {
    if (!(await findLeague(db, userId, id))) return error(404, "League not found");
    if (!dryRun) {
      const gate = await consentGate(db, userId, body.consentVersion);
      if (gate) return gate;
    }

    const load = await loadSeasonView(db, key, userId, id);
    if (load.kind !== "ok") return refuse({ kind: "problem", problem: load.kind });
    const { view } = load;
    if (view.currentWeek !== body.week) return refuse({ kind: "changed", changes: [`ESPN has moved on to week ${view.currentWeek}.`] });
    const changed = rosterChanges(body.snapshot, view.teams.find((t) => t.id === view.myTeamId)?.roster ?? []);
    if (changed.length) return refuse({ kind: "changed", changes: changed });

    const target = lineupTarget(view, body.lineup, body.changes, body.ir);
    if (!target) return error(400, "That lineup doesn't match this league's slots");
    if (dryRun) return json(200, dryRunResponse(target));
    if (!target.moves.length || target.problems.length) return refuse({ kind: "refused", problems: target.problems.length ? target.problems : ["There's nothing to change."] });

    const out = await writeLineup(db, key, userId, id, { week: body.week, season: body.season, snapshot: body.snapshot, moves: target.moves, suggested: target.suggested }, { alert, failed });
    const names = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
    return writeResponse(out.kind === "applied" ? { kind: "applied", landed: out.moves } : out, {
      what: "lineup apply",
      alert,
      unverified: { changes: target.changes.filter((c) => c.picked).map((c) => ({ id: c.id, text: c.text })) },
      applied: (moves) => json(200, appliedResponse(target, moves, (playerId) => names.get(playerId) ?? `Player ${playerId}`)),
    });
  } catch (err) {
    failed(err);
    return error(503, "Setting your lineup on ESPN is temporarily unavailable");
  }
});
