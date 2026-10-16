import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { findKeptWeek, latestKeptSeason } from "@/lib/server/seasonRecaps";
import { recapResponse } from "@/lib/server/v1/recaps";

type Ctx = RouteContext<"/api/v1/leagues/[id]/recaps/[week]">;

/** A whole number from 1 to `max` written without extras, or null. */
function wholeNumber(raw: string | null, max: number): number | null {
  if (raw === null || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= max ? n : null;
}

/**
 * GET /api/v1/leagues/:id/recaps/:week[?season=2026] → RecapResponse (src/lib/server/v1/recaps.ts)
 *
 * One kept week of the iPhone app's recap archive (APE-383), told as the web's RecapArchive tells
 * it, with what the web's recap card draws so the app can draw its own. `season` defaults to the
 * newest season with a kept week. 404 when the week isn't kept; 400 for a week or season that
 * isn't a number. Gated like the season route.
 */
export const GET = withUser<Ctx>(async (request, ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  const { id, week: rawWeek } = await ctx.params;
  const week = wholeNumber(rawWeek, 30);
  const rawSeason = new URL(request.url).searchParams.get("season");
  const asked = rawSeason === null ? null : wholeNumber(rawSeason, 9999);
  if (week === null || (rawSeason !== null && asked === null)) return error(400, "Invalid week");
  const league = await findLeague(db, userId, id);
  if (!league) return error(404, "League not found");
  const season = asked ?? (await latestKeptSeason(db, id));
  const kept = season === null ? null : await findKeptWeek(db, id, season, week);
  if (!kept) return error(404, "No recap for that week yet");
  return json(200, recapResponse({ id, name: league.name }, kept));
});
