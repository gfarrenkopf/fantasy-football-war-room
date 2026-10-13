import { appleDisplayName } from "@/lib/auth/apple";
import { AppAuthError, appleKeysFrom, userForAppleIdentity, verifyAppleIdentityToken } from "@/lib/server/appAuth";
import { readAuthRequest, sessionResponse, str } from "@/lib/server/appAuthRoutes";
import { error } from "@/lib/server/http";

const keys = appleKeysFrom();

/**
 * POST /api/v1/auth/apple { identityToken, nonce, fullName?: { givenName, familyName } }
 *   → { token, expiresAt, user, isNew }
 *
 * The app's Sign in with Apple. `nonce` is the raw value whose SHA-256 the app put in the Apple
 * request; `fullName` is only present on the user's first consent.
 */
export async function POST(request: Request): Promise<Response> {
  const req = await readAuthRequest(request);
  if (!req.ok) return req.response;
  const identityToken = str(req.body.identityToken, 8192);
  const nonce = str(req.body.nonce, 256);
  if (!identityToken || !nonce) return error(400, "identityToken and nonce are required");
  const fullName = (req.body.fullName ?? null) as { givenName?: unknown; familyName?: unknown } | null;
  const name = appleDisplayName({ firstName: str(fullName?.givenName, 100), lastName: str(fullName?.familyName, 100) });

  let identity;
  try {
    identity = await verifyAppleIdentityToken(identityToken, { nonce, keys });
  } catch (e) {
    if (e instanceof AppAuthError) return error(401, "Apple sign-in couldn't be verified");
    throw e;
  }
  const { userId, isNew } = await userForAppleIdentity(req.db, identity, name);
  return sessionResponse(req.db, userId, isNew);
}
