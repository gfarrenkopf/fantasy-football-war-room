import { config } from "@/lib/config";
import { ESPN_ORIGIN } from "@/lib/server/espn/bridgeCors";
import { beaconLine, logBudget, MAX_BEACON_BYTES } from "@/lib/server/espn/bridgeBeacon";
import { empty, isSameOrigin } from "@/lib/server/http";

const budget = logBudget(300, 60_000);

/**
 * POST /api/espn/bridge/beacon (text/plain JSON) → 204
 *
 * The bridge saying it loaded, failed, or how pairing went (APE-331), from the user's ESPN tab or
 * from Draft Room's own setup page. Sent no-cors as plain text so no preflight is needed, and the
 * bridge never reads the answer, so this always answers 204 and only ever writes a log line.
 */
export async function POST(request: Request) {
  if (!config.espnSyncEnabled) return empty(404);
  if (request.headers.get("origin") !== ESPN_ORIGIN && !isSameOrigin(request)) return empty(204);
  const text = await request.text();
  if (text.length > MAX_BEACON_BYTES) return empty(204);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return empty(204);
  }
  const beacon = beaconLine(body);
  if (beacon && budget()) {
    if (beacon.problem) console.warn(beacon.line);
    else console.info(beacon.line);
  }
  return empty(204);
}
