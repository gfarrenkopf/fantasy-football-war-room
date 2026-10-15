import { config } from "@/lib/config";
import { parseAlertChanges } from "@/lib/season/alerts";
import { withUser } from "@/lib/server/api";
import { error, json, readJson } from "@/lib/server/http";
import { setAlertChannels } from "@/lib/server/seasonPrefs";
import { notificationsResponse } from "@/lib/server/v1/notifications";

const server = () => ({ email: config.emailAuthEnabled, push: config.pushEnabled });

/**
 * GET /api/v1/notifications → NotificationsResponse (src/lib/server/v1/notifications.ts)
 *
 * Each season alert and how it reaches the user: email, push, both or off (21.3). Used by the
 * iPhone app's settings and the web's account menu.
 */
export const GET = withUser(async (_request, _ctx, { db, userId }) => json(200, await notificationsResponse(db, userId, server())));

/** PUT /api/v1/notifications { alerts: { [kind]: channel } } → NotificationsResponse. Alerts left out keep their setting. */
export const PUT = withUser(async (request, _ctx, { db, userId }) => {
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const changes = parseAlertChanges(read.body);
  if (!changes) return error(400, 'Expected { alerts: { [kind]: "email" | "push" | "both" | "off" } }');
  await setAlertChannels(db, userId, changes);
  return json(200, await notificationsResponse(db, userId, server()));
});
