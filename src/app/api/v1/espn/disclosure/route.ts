import { config } from "@/lib/config";
import { ESPN_DISCLOSURE, ESPN_DISCLOSURE_VERSION } from "@/lib/espn/disclosure";
import { error, json } from "@/lib/server/http";

/**
 * GET /api/v1/espn/disclosure → { version, points }
 *
 * What the app shows before the user signs in to ESPN: the web's own disclosure text and version
 * (src/lib/espn/disclosure.ts), served so the two can never differ. Public text, no sign-in needed.
 */
export function GET(): Response {
  if (!config.espnSeasonEnabled) return error(404, "Not found");
  return json(200, { version: ESPN_DISCLOSURE_VERSION, points: ESPN_DISCLOSURE });
}
