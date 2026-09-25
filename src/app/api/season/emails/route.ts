import { withUser } from "@/lib/server/api";
import { error, json, readJson } from "@/lib/server/http";
import { setSeasonEmails } from "@/lib/server/seasonPrefs";

/** PUT /api/season/emails { on } → { on }: whether the signed-in user gets the Sunday job's emails (11.3). */
export const PUT = withUser<unknown>(async (request, _ctx, { db, userId }) => {
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const on = (read.body as { on?: unknown } | null)?.on;
  if (typeof on !== "boolean") return error(400, "Expected { on: boolean }");
  await setSeasonEmails(db, userId, on);
  return json(200, { on });
});
