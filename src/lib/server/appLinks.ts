/**
 * The web paths the iPhone app claims or lands on. Shared by the sign-in routes and the
 * apple-app-site-association file, so the two can't disagree.
 */

/** Where Google sign-in in the system browser hands back to the app, with `?code=`. A Universal Link. */
export const APP_CALLBACK_PATH = "/app/callback";

/** The destination of magic links asked for in the app. The Universal Link rule matches it in the link's callbackUrl. */
export const APP_SIGNED_IN_PATH = "/app/signed-in";

/** The app's own URL scheme, used for the Google hand-off only on development servers (no Universal Links on localhost). */
export const APP_SCHEME = "draftroom";

/**
 * The oldest app version this server still works with (GET /api/v1/me). Raise it when a change
 * would break older builds, which a v1 route never should; those builds then ask the user to update.
 */
export const MIN_APP_VERSION = "1.0";
