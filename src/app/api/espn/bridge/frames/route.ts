import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getRelay, verifyBridge } from "@/lib/server/espn/live";
import type { CommandResult } from "@/lib/server/espn/relay";
import { empty, error, json, readJson } from "@/lib/server/http";

/** The only page that may call this: the user's ESPN draft tab, where the bridge runs. */
const ESPN_ORIGIN = "https://fantasy.espn.com";

function withCors(response: Response, request: Request): Response {
  if (request.headers.get("origin") === ESPN_ORIGIN) {
    response.headers.set("Access-Control-Allow-Origin", ESPN_ORIGIN);
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** CORS preflight for the bridge's JSON POST with an Authorization header. */
export function OPTIONS(request: Request) {
  if (!config.espnSyncEnabled || request.headers.get("origin") !== ESPN_ORIGIN) return empty(404);
  const response = empty(204);
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "authorization, content-type");
  response.headers.set("Access-Control-Max-Age", "600");
  // Chrome's Private Network Access asks before a public site calls a local server, as it does when
  // testing the bridge against `next dev` on localhost. Harmless for the hosted site.
  if (request.headers.get("access-control-request-private-network") === "true") response.headers.set("Access-Control-Allow-Private-Network", "true");
  return withCors(response, request);
}

interface FramesRequest {
  espnLeagueId: string;
  session: string;
  seq: number;
  frames: string[];
  /** What happened to the last pick command the bridge was handed. */
  result?: CommandResult;
  /** The version of the overlay's turn plan the bridge already has. */
  planVersion: number;
  /** ESPN's own league settings, sent when the bridge first reads them and whenever they change (8.8). */
  settings?: unknown;
}

function parse(body: unknown): FramesRequest | null {
  const b = (body ?? {}) as Partial<FramesRequest>;
  if (typeof b.espnLeagueId !== "string" || typeof b.session !== "string" || !/^[a-z0-9]{6,64}$/.test(b.session)) return null;
  if (!Number.isInteger(b.seq) || b.seq! < 0 || !Array.isArray(b.frames) || !b.frames.every((f) => typeof f === "string" && f.length <= 4096)) return null;
  const r = b.result as Partial<CommandResult> | undefined;
  const result =
    r && typeof r.id === "string" && typeof r.sent === "boolean"
      ? { id: r.id.slice(0, 64), sent: r.sent, ...(typeof r.reason === "string" ? { reason: r.reason.slice(0, 64) } : {}) }
      : undefined;
  const planVersion = Number.isInteger(b.planVersion) && b.planVersion! >= 0 ? b.planVersion! : 0;
  return { espnLeagueId: b.espnLeagueId, session: b.session, seq: b.seq!, frames: b.frames, result, planVersion, settings: b.settings };
}

/**
 * POST /api/espn/bridge/frames { espnLeagueId, session, seq, frames, result?, planVersion? } → { have, command?, plan? }
 *
 * The ESPN bridge (public/espn-bridge.js) relaying draft frames, authenticated by its pairing
 * token rather than the session cookie, which cross-site requests don't carry. `seq` is the offset
 * of the first frame in this session's log: 200 when it matches what the relay holds, 409 with the
 * relay's count when it doesn't (the bridge resends from there). An empty `frames` is a heartbeat.
 * `command` is a pick the user made in War Room, for the bridge to make in ESPN; the bridge reports
 * what it did with it as `result` on its next request. `plan` is the overlay's turn plan, sent only
 * when it's newer than the bridge's `planVersion`.
 */
export async function POST(request: Request) {
  if (!config.espnSyncEnabled) return withCors(error(404, "Not found"), request);
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const bridge = token ? await verifyBridge(getDb(), token) : null;
  if (!bridge) return withCors(error(401, "Pair the bridge again"), request);
  const read = await readJson(request);
  if (!read.ok) return withCors(read.response, request);
  const body = parse(read.body);
  if (!body) return withCors(error(400, "Invalid frames"), request);
  if (body.espnLeagueId !== bridge.espnLeagueId) return withCors(error(403, "This bridge is paired to a different ESPN league"), request);

  const result = await getRelay().ingest(bridge, body.session, body.seq, body.frames, body.result, body.planVersion);
  // After ingest: re-pairing to a different ESPN league resets the channel, and these settings
  // describe the league it just moved to.
  if (body.settings !== undefined) getRelay().setLeague(bridge, body.settings);
  if (result.status === 413) return withCors(error(413, "Too many frames"), request);
  const { status, ...reply } = result;
  return withCors(json(status, reply), request);
}
