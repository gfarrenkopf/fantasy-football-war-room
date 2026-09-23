import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { ESPN_HANDOVER_DISCLOSURE, ESPN_HANDOVER_VERSION } from "@/lib/espn/disclosure";
import { preflight, withCors } from "@/lib/server/espn/bridgeCors";
import { getRelay, verifyBridge } from "@/lib/server/espn/live";
import type { CommandResult } from "@/lib/server/espn/relay";
import { handBack } from "@/lib/server/espn/clients";
import { deleteCredential } from "@/lib/server/espn/serverClients";
import { error, json, readJson } from "@/lib/server/http";

/** CORS preflight for the bridge's JSON POST with an Authorization header. */
export function OPTIONS(request: Request) {
  return preflight(request, config.espnSyncEnabled);
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
  /** The version of the hand-over opt-in (9.1) the bridge already shows. */
  handoverVersion: number;
  /** The user clicked "Draft here instead" in the overlay: War Room hands its ESPN connection back. */
  release: boolean;
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
  const handoverVersion = Number.isInteger(b.handoverVersion) ? b.handoverVersion! : 0;
  return { espnLeagueId: b.espnLeagueId, session: b.session, seq: b.seq!, frames: b.frames, result, planVersion, settings: b.settings, handoverVersion, release: b.release === true };
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
 * when it's newer than the bridge's `planVersion`. `held` means War Room holds (or is taking) the
 * user's ESPN connection, so the bridge keeps ESPN's page from reconnecting; `release` hands it back. `handover` is the opt-in for drafting without this
 * tab (9.1), sent when that's available and newer than the bridge's `handoverVersion`.
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

  // Before ingest, so this reply already tells the bridge it may let ESPN's page reconnect.
  if (body.release) await handBack(getDb(), bridge.userId, bridge.leagueId);
  const result = await getRelay().ingest(bridge, body.session, body.seq, body.frames, body.result, body.planVersion);
  // After ingest: re-pairing to a different ESPN league resets the channel, and these settings
  // describe the league it just moved to.
  if (body.settings !== undefined) getRelay().setLeague(bridge, body.settings);
  if (result.status === 413) return withCors(error(413, "Too many frames"), request);
  // The draft is over: a join credential the user handed over has done its job (9.1).
  if (result.status === 200 && body.frames.some((f) => f.startsWith("STATE 2"))) await deleteCredential(getDb(), bridge.userId, bridge.leagueId);
  const { status, ...reply } = result;
  const handover =
    config.espnServerClientEnabled && body.handoverVersion !== ESPN_HANDOVER_VERSION
      ? { handover: { version: ESPN_HANDOVER_VERSION, lines: ESPN_HANDOVER_DISCLOSURE } }
      : {};
  return withCors(json(status, { ...reply, ...handover }), request);
}
