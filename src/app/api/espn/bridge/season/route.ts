import { eq } from "drizzle-orm";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import { preflight, withCors } from "@/lib/server/espn/bridgeCors";
import { hasAcknowledgedDisclosure } from "@/lib/server/espn/disclosure";
import { verifyBridge } from "@/lib/server/espn/live";
import { parseEspnLogin } from "@/lib/server/espn/logins";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { connectSeason } from "@/lib/server/espn/seasonConnect";
import { error, json, readJson } from "@/lib/server/http";

const enabled = () => config.espnSeasonEnabled && !!config.espnCodeKey;

export function OPTIONS(request: Request) {
  return preflight(request, config.espnSyncEnabled);
}

/**
 * POST /api/espn/bridge/season { espnS2, swid } → { connected }
 *
 * The bridge in a paired ESPN draft connecting the user's season too (APE-332): pairing asked the
 * same consent as connecting a season, and the login is right there in the draft tab, so the user
 * gets in-season help without a second trip. Authenticated by the pairing token like /frames, and
 * scoped to its league. `connected: false` when in-season help isn't on, or isn't for this account
 * yet: skipped quietly, since the draft is connected either way. 503 when ESPN couldn't be reached,
 * so the bridge tries again on its next load. The login is a credential: no response or log line
 * here includes it.
 */
export async function POST(request: Request) {
  if (!config.espnSyncEnabled) return withCors(error(404, "Not found"), request);
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const db = getDb();
  const bridge = token ? await verifyBridge(db, token) : null;
  if (!bridge) return withCors(error(401, "Pair the bridge again"), request);
  const read = await readJson(request);
  if (!read.ok) return withCors(read.response, request);
  const login = parseEspnLogin(read.body);
  if (!login) return withCors(error(400, "Invalid login"), request);
  if (!enabled()) return withCors(json(200, { connected: false }), request);

  const { userId, espnLeagueId, season } = bridge;
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!mayUseSeason(config.espnSyncAllowlist, user?.email ?? null)) return withCors(json(200, { connected: false }), request);
  // Pairing asks for it, so this only fails for a token minted before the disclosure changed.
  if (!(await hasAcknowledgedDisclosure(db, userId, ESPN_DISCLOSURE_VERSION))) return withCors(json(200, { connected: false }), request);

  const result = await connectSeason(db, config.espnCodeKey!, userId, { espnLeagueId, season, consentVersion: ESPN_DISCLOSURE_VERSION, ...login });
  if (!result.ok && result.status === 503) return withCors(error(503, result.error), request);
  if (!result.ok) console.warn(`[espn-season] connect from draft skipped: ${result.status}`);
  return withCors(json(200, { connected: result.ok }), request);
}
