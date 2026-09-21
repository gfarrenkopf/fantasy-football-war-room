import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getRelay, verifyBridge } from "@/lib/server/espn/live";
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
  return withCors(response, request);
}

interface FramesRequest {
  espnLeagueId: string;
  session: string;
  seq: number;
  frames: string[];
}

function parse(body: unknown): FramesRequest | null {
  const b = (body ?? {}) as Partial<FramesRequest>;
  if (typeof b.espnLeagueId !== "string" || typeof b.session !== "string" || !/^[a-z0-9]{6,64}$/.test(b.session)) return null;
  if (!Number.isInteger(b.seq) || b.seq! < 0 || !Array.isArray(b.frames) || !b.frames.every((f) => typeof f === "string" && f.length <= 4096)) return null;
  return { espnLeagueId: b.espnLeagueId, session: b.session, seq: b.seq!, frames: b.frames };
}

/**
 * POST /api/espn/bridge/frames { espnLeagueId, session, seq, frames } → { have }
 *
 * The ESPN bridge (public/espn-bridge.js) relaying draft frames, authenticated by its pairing
 * token rather than the session cookie, which cross-site requests don't carry. `seq` is the offset
 * of the first frame in this session's log: 200 when it matches what the relay holds, 409 with the
 * relay's count when it doesn't (the bridge resends from there). An empty `frames` is a heartbeat.
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

  const result = await getRelay().ingest(bridge, body.session, body.seq, body.frames);
  if (result.status === 413) return withCors(error(413, "Too many frames"), request);
  return withCors(json(result.status, { have: result.have }), request);
}
