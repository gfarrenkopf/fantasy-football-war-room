import { config } from "@/lib/config";
import { withUser } from "@/lib/server/api";
import { espnAccess } from "@/lib/server/espn/access";
import { mintBridgeToken, purgeExpiredBridgeTokens } from "@/lib/server/espn/bridgeTokens";
import { error, json, readJson } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";

interface PairRequest {
  leagueId: string;
  espnLeagueId: string;
  espnTeamId: number;
  season: number;
}

function parsePairRequest(body: unknown): PairRequest | null {
  const b = (body ?? {}) as Partial<PairRequest>;
  if (typeof b.leagueId !== "string" || !b.leagueId) return null;
  if (typeof b.espnLeagueId !== "string" || !/^\d{1,12}$/.test(b.espnLeagueId)) return null;
  if (!Number.isInteger(b.espnTeamId) || b.espnTeamId! < 1 || b.espnTeamId! > 64) return null;
  if (!Number.isInteger(b.season) || b.season! < 2000 || b.season! > 2100) return null;
  return { leagueId: b.leagueId, espnLeagueId: b.espnLeagueId, espnTeamId: b.espnTeamId!, season: b.season! };
}

/**
 * POST /api/espn/pair { leagueId, espnLeagueId, espnTeamId, season } → { token, expiresAt }
 *
 * Called by the pairing popup the ESPN bridge opens (same-origin, signed in). The token goes back to
 * the bridge, which authenticates its relay requests with it. 404 when ESPN sync is off or the league
 * isn't the user's, 403 outside the beta, 402 when the league needs a season pass.
 */
export const POST = withUser(async (request, _ctx, { db, userId, email }) => {
  if (!config.espnSyncEnabled) return error(404, "Not found");
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const pair = parsePairRequest(read.body);
  if (!pair) return error(400, "Invalid pairing request");
  if (!(await findLeague(db, userId, pair.leagueId))) return error(404, "League not found");
  const access = await espnAccess(db, pair.leagueId, email);
  if (access.kind === "not-allowed") return error(403, "ESPN live sync isn't available on this account yet");
  if (access.kind === "needs-purchase") return json(402, { needsPurchase: true });
  await purgeExpiredBridgeTokens(db);
  const { token, expiresAt } = await mintBridgeToken(db, { userId, ...pair });
  return json(200, { token, expiresAt: expiresAt.toISOString() });
});
