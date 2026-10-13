import { APP_CALLBACK_PATH, APP_SIGNED_IN_PATH } from "./appLinks";

/** The iPhone app's bundle ID. Its app ID, for Universal Links, is `<TeamID>.<bundle ID>`. */
export const APP_BUNDLE_ID = "tech.apeman.draftroom";

/**
 * The apple-app-site-association file (APE-375): which draftroom.online links open the iPhone app
 * when it's installed. Everything not listed stays on the web. iOS fetches this through Apple's
 * CDN when the app is installed, so a change can take a day or more to reach phones.
 *
 * - The magic link, but only one asked for in the app: Auth.js puts the link's destination in
 *   `callbackUrl`, and the app asks for /app/signed-in (POST /api/v1/auth/email/start). A link
 *   asked for on the web, opened on a phone that has the app, keeps signing in the browser.
 * - Google sign-in's hand-off back to the app (/api/v1/auth/handoff).
 * - Season pages, so links in the season emails open the league in the app.
 */
export function appSiteAssociation(teamId: string) {
  const appId = `${teamId}.${APP_BUNDLE_ID}`;
  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: [
            { "/": "/api/auth/callback/resend", "?": { callbackUrl: `*${APP_SIGNED_IN_PATH}*` }, comment: "Magic links asked for in the app" },
            { "/": APP_CALLBACK_PATH, "?": { code: "?*" }, comment: "Google sign-in handing back to the app" },
            { "/": "/season/*", comment: "Season pages, from the season emails" },
          ],
        },
      ],
    },
    webcredentials: { apps: [appId] },
  };
}
