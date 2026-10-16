import "server-only";
import { config } from "@/lib/config";
import type { Db } from "@/lib/db/types";
import { error, readJson } from "../http";
import { mayUseSeason } from "./access";
import { parseEspnLogin, type EspnLogin } from "./logins";

/**
 * The gates and body parsing shared by the iPhone app's ESPN routes (/api/v1/espn, APE-377), the
 * same as the web's season routes: in-season features on, and the account allowed in.
 */
export async function seasonGate(db: Db, userId: string, email: string | null): Promise<Response | null> {
  if (!config.espnSeasonEnabled || !config.espnCodeKey) return error(404, "Not found");
  if (!(await mayUseSeason(db, userId, email))) return error(403, "In-season help isn't available on this account yet");
  return null;
}

/** The ESPN login the app captured, plus the rest of the body, or the error response. Never logged. */
export async function readLoginBody(request: Request): Promise<{ ok: true; login: EspnLogin; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const read = await readJson(request);
  if (!read.ok) return read;
  const body = (read.body ?? {}) as Record<string, unknown>;
  const login = parseEspnLogin(body);
  if (!login) return { ok: false, response: error(400, "That ESPN sign-in didn't come through. Sign in to ESPN again.") };
  return { ok: true, login, body };
}

