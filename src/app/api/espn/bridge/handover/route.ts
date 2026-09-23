import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { ESPN_HANDOVER_VERSION } from "@/lib/espn/disclosure";
import { preflight, withCors } from "@/lib/server/espn/bridgeCors";
import { verifyBridge } from "@/lib/server/espn/live";
import { purgeExpiredCredentials, storeCredential } from "@/lib/server/espn/serverClients";
import { error, json, readJson } from "@/lib/server/http";

export function OPTIONS(request: Request) {
  return preflight(request, config.espnServerClientEnabled);
}

interface HandoverRequest {
  espnLeagueId: string;
  /** The opt-in version the user agreed to in the overlay. */
  consentVersion: number;
  code: string;
  swid: string;
  settings?: unknown;
  pickTeams: number[] | null;
}

function parse(body: unknown): HandoverRequest | null {
  const b = (body ?? {}) as Partial<HandoverRequest>;
  if (typeof b.espnLeagueId !== "string" || !Number.isInteger(b.consentVersion)) return null;
  // The code is a signed integer and can be negative (docs/espn-protocol.md §3).
  if (typeof b.code !== "string" || !/^-?\d{1,12}$/.test(b.code)) return null;
  if (typeof b.swid !== "string" || !/^\{[0-9A-Fa-f-]{36}\}$/.test(b.swid)) return null;
  const pickTeams =
    Array.isArray(b.pickTeams) && b.pickTeams.length <= 1000 && b.pickTeams.every((t) => Number.isInteger(t) && t >= 1 && t <= 64) ? b.pickTeams : null;
  return { espnLeagueId: b.espnLeagueId, consentVersion: b.consentVersion!, code: b.code, swid: b.swid, settings: b.settings, pickTeams };
}

/**
 * POST /api/espn/bridge/handover { espnLeagueId, consentVersion, code, swid, settings?, pickTeams? } → { stored: true }
 *
 * The bridge handing over the ESPN draft room's join code (9.1), once, after the user opted in from
 * the overlay. Authenticated by the pairing token like /frames. The code is a credential: it's sealed
 * before it's stored, and no response or log line here ever includes it. 404 when drafting without
 * an ESPN tab is off, 409 when the opt-in the user saw is out of date.
 */
export async function POST(request: Request) {
  if (!config.espnServerClientEnabled || !config.espnCodeKey) return withCors(error(404, "Not found"), request);
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const db = getDb();
  const bridge = token ? await verifyBridge(db, token) : null;
  if (!bridge) return withCors(error(401, "Pair the bridge again"), request);
  const read = await readJson(request);
  if (!read.ok) return withCors(read.response, request);
  const body = parse(read.body);
  if (!body) return withCors(error(400, "Invalid hand-over"), request);
  if (body.espnLeagueId !== bridge.espnLeagueId) return withCors(error(403, "This bridge is paired to a different ESPN league"), request);
  if (body.consentVersion !== ESPN_HANDOVER_VERSION) return withCors(json(409, { handoverVersion: ESPN_HANDOVER_VERSION }), request);

  await purgeExpiredCredentials(db);
  const { userId, leagueId, espnLeagueId, espnTeamId, season } = bridge;
  await storeCredential(
    db,
    config.espnCodeKey,
    { userId, leagueId, espnLeagueId, espnTeamId, season },
    { code: body.code, swid: body.swid },
    { leagueSettings: body.settings, pickTeams: body.pickTeams, consentVersion: body.consentVersion },
  );
  return withCors(json(200, { stored: true }), request);
}
