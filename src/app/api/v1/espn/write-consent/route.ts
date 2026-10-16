import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { withUser } from "@/lib/server/api";
import { seasonGate } from "@/lib/server/espn/appEspn";
import { isObject } from "@/lib/server/espn/lineupWrite";
import { consentGate, consentOf } from "@/lib/server/espn/writeRoute";
import { error, json, readJson } from "@/lib/server/http";

/**
 * POST /api/v1/espn/write-consent { version } → { version, agreed: true }
 *
 * Records the user's consent to Draft Room changing their team on ESPN (Epic 13), from the iPhone
 * app's confirm sheet (APE-381). The text and version come from the season route; this records the
 * same consent the web records with its first write, through the same gate. 409 `{ consent }` with
 * the current text when `version` is out of date.
 */
export const POST = withUser(async (request, _ctx, { db, userId, email }) => {
  const gated = await seasonGate(db, userId, email);
  if (gated) return gated;
  const read = await readJson(request);
  if (!read.ok) return read.response;
  if (!isObject(read.body) || !Number.isInteger(read.body.version)) return error(400, "Invalid consent");
  const gate = await consentGate(db, userId, consentOf({ consentVersion: read.body.version }));
  if (gate) return gate;
  return json(200, { version: ESPN_WRITE_VERSION, agreed: true });
});
