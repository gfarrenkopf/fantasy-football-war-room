import { config } from "@/lib/config";
import type { LiveMatchup } from "@/lib/season/liveMatchup";
import { withUser } from "@/lib/server/api";
import { startTokensFor } from "@/lib/server/devices";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { listSeasonLinks } from "@/lib/server/espn/seasonLinks";
import { error, json, readJson } from "@/lib/server/http";
import { livePayload } from "@/lib/server/liveActivities";
import { apnsClient, logPushError, sendPush } from "@/lib/server/push";
import { isReviewAccount } from "@/lib/server/reviewAccount";
import { liveMatchup } from "@/lib/server/v1/season";

/** Shown when the review league has no matchup to follow, such as a bye week or a closed season. */
const SAMPLE_MATCHUP: LiveMatchup = {
  week: 1,
  status: "Live",
  live: true,
  started: true,
  decided: false,
  lead: 12.4,
  win: 68,
  me: { teamId: 1, name: "Your team", points: 84.6, projected: 118.2, left: 3 },
  them: { teamId: 2, name: "Opponent", points: 72.2, projected: 104.9, left: 4 },
};

/**
 * POST /api/v1/review/sample { kind: "alert" | "live" } → { sent }
 *
 * For App Review's account only (APE-398), from a Settings row only it sees: sends a sample alert, or
 * starts the Game day Live Activity by push-to-start, so the reviewer can see both without waiting for
 * a real game. Straight to APNs, past notify()'s once-a-day rule, so it works every time it's tapped.
 * 404 for every other account.
 */
export const POST = withUser<unknown>(async (request, _ctx, { db, userId, email }) => {
  if (!isReviewAccount(email)) return error(404, "Not found");
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const kind = (parsed.body as { kind?: unknown } | null)?.kind;
  if (kind !== "alert" && kind !== "live") return error(400, "kind must be alert or live");
  const apns = apnsClient();
  if (!apns) return error(503, "Push notifications aren't set up on this server.");

  if (kind === "alert") {
    const result = await sendPush(db, userId, { title: "Lineup check", body: "This is a sample alert. Real ones flag a starter who's ruled out before kickoff." }, apns);
    if (!result.sent) return error(409, "No iPhone is registered for alerts. Allow notifications for Draft Room, then try again.");
    return json(200, { sent: result.sent });
  }

  const devices = await startTokensFor(db, userId);
  if (!devices.length) return error(409, "This iPhone can't start a Live Activity yet. Allow Live Activities for Draft Room, reopen the app, then try again.");
  const [league] = await listSeasonLinks(db, userId);
  let state = SAMPLE_MATCHUP;
  if (league && config.espnCodeKey) {
    const load = await loadSeasonView(db, config.espnCodeKey, userId, league.leagueId).catch(() => null);
    if (load?.kind === "ok") state = liveMatchup(load.view, load.phase) ?? state;
  }
  const attributes = { leagueId: league?.leagueId ?? "sample", league: league?.name ?? "Sample league" };
  const now = new Date();
  let sent = 0;
  for (const device of devices) {
    const outcome = await apns.send(device, {
      pushType: "liveactivity",
      topic: `${config.apnsBundleId}.push-type.liveactivity`,
      payload: livePayload("start", state, now, { attributes, alert: { title: `${attributes.league} is live`, body: state.status } }),
      priority: 10,
    });
    if (outcome.kind === "sent") sent++;
    else if (outcome.kind === "failed") logPushError("APNs refused a sample Live Activity", { status: outcome.status, reason: outcome.reason });
  }
  if (!sent) return error(502, "APNs didn't take the Live Activity. Reopen the app and try again.");
  return json(200, { sent });
});
