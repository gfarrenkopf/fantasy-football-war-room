import { userForEmail } from "@/lib/server/appAuth";
import { readAuthRequest, sessionResponse, str } from "@/lib/server/appAuthRoutes";
import { error } from "@/lib/server/http";
import { rateLimiter } from "@/lib/server/rateLimit";
import { checkReviewCode, ensureReviewSetup } from "@/lib/server/reviewAccount";

/** Five codes per email per quarter hour, on top of the per-address limit every sign-in route has. */
const perEmail = rateLimiter({ limit: 5, windowMs: 15 * 60_000 });

/**
 * POST /api/v1/auth/email/code { email, code } → { token, expiresAt, user, isNew }
 *
 * App Review's sign-in (APE-398): the review account's email with its fixed code, in place of the
 * magic link Apple's reviewer can't receive. email/start asks for a code for that one email only, and
 * this route takes one for no other. Connects the review leagues before answering, so the reviewer
 * lands in them; if ESPN is down they still get in, to an empty account.
 */
export async function POST(request: Request): Promise<Response> {
  const req = await readAuthRequest(request);
  if (!req.ok) return req.response;
  const email = str(req.body.email, 254)?.trim().toLowerCase();
  const code = str(req.body.code, 256);
  if (!email || !code) return error(400, "Enter your email and code.");
  if (!perEmail.allow(email)) return error(429, "Too many attempts. Wait a few minutes and try again.");
  if (!checkReviewCode(email, code)) return error(401, "That code isn't right.");

  const { userId, isNew } = await userForEmail(req.db, email);
  try {
    const setup = await ensureReviewSetup(req.db, userId);
    if (!setup.ok) console.warn(`[review] couldn't set up the review leagues: ${setup.error}`);
  } catch (err) {
    console.warn(`[review] couldn't set up the review leagues: ${(err as Error).message}`);
  }
  return sessionResponse(req.db, userId, isNew);
}
