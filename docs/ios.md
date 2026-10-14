# Draft Room for iOS

The plan for the native iPhone app, decided in the APE-312 spike (2026-10-12), and the runbook for shipping it. The app lives in `mobile/ios/` once Epic 17 scaffolds it; until then this document is the plan.

The web app keeps working exactly as it does. The iOS app is a client of the hosted server, so it needs cloud features on (`cloudEnabled`); self-hosting is unaffected.

## Contents

1. [Why an app](#1-why-an-app)
2. [Decisions](#2-decisions)
3. [How it fits together](#3-how-it-fits-together)
4. [Sign-in](#4-sign-in)
5. [Connecting ESPN](#5-connecting-espn)
6. [Push notifications and the Live Activity](#6-push-notifications-and-the-live-activity)
7. [Design on iOS](#7-design-on-ios)
8. [Building and testing](#8-building-and-testing)
9. [First launch: from nothing to TestFlight](#9-first-launch-from-nothing-to-testflight)
10. [App Review: what gets apps rejected](#10-app-review-what-gets-apps-rejected)
11. [The epics](#11-the-epics)
12. [Later: v2 and in-app purchase](#12-later-v2-and-in-app-purchase)

---

## 1. Why an app

Connecting ESPN on a phone is the weak spot of the web app. The bridge (`public/espn-bridge.js`) is a bookmarklet, so the user has to save it, find it, and run it in Safari on the right ESPN page. On iPhone the ESPN app also takes over most ESPN links before Safari sees them (APE-303, [espn-protocol.md](espn-protocol.md)). A native app can show ESPN's own sign-in page in a web view it controls and read the two cookies Draft Room needs straight from it: no bookmarklet, no link hijack.

Most players also live in apps, not browsers, and an app can do things a web page can't: push notifications, a lock-screen Live Activity for game day, and system-level animation and haptics.

## 2. Decisions

| Question | Decision |
|---|---|
| What v1 does | The **in-season** product plus ESPN connection. The beta needs all three feature sets, built in this order: Game day, lineups and recaps; then team management (IR, add/drop, waivers); then AI lineups and trade write-ups. |
| What v2 does | The full draft room, before the 2027 drafts. |
| Technology | **SwiftUI**. iOS only, and the delight moments must be smooth, which favors the native toolkit over React Native/Expo. |
| Minimum iOS | **iOS 18**, so nearly every active iPhone can run it. iOS 26 features (Liquid Glass and newer APIs) are used behind `#available` checks. |
| Third-party code | **None** to start. URLSession, Codable, the Keychain, ActivityKit and AuthenticationServices cover v1. A ticket that adds a Swift package says why. |
| Where the code lives | `mobile/ios/` in this repo, so the app and the API change in one PR and agents can read the server code. |
| Developer account | **Organization**, Apeman Tech, so the App Store shows the company, not a person. |
| Name | **Draft Room**, subtitle **Fantasy Football Manager**. App names are capped at 30 characters; the subtitle (also 30) shows under the name and counts for search. |
| Bundle ID | `tech.apeman.draftroom`. Bundle IDs are reverse-DNS of a domain you own (`apeman.tech` → `tech.apeman`), and they can never change after the first upload. |
| Web domain | `draftroom.online`, for Universal Links. |
| Payments | No purchase UI in v1; the app reads entitlements from the server. In-app purchase comes with post-beta pricing (APE-342). See [§12](#12-later-v2-and-in-app-purchase). |
| ESPN branding | Text only: "Works with ESPN Fantasy". No ESPN logos, colors or marks anywhere in the app or its Store listing. |
| Timeline | **Internal TestFlight ~2026-11-16**, as soon as Game day and lineups work. **External TestFlight ~2026-12-07** (NFL week 14), held until all three feature sets are in, so testers have it for the fantasy playoffs. |

## 3. How it fits together

```
iPhone app (SwiftUI)
  │  HTTPS, Authorization: Bearer <session token>
  ▼
/api/v1/...  (Next.js route handlers, JSON only)
  │  same functions the web pages use
  ▼
src/lib/server/*  ──▶ Postgres, ESPN, AI, Resend, APNs
```

- **The app holds no business logic of its own in v1.** Everything the season page computes on the server (`loadSeasonView` in `src/lib/server/espn/seasonView.ts`, the AI outputs, lineup writes through `applyLineup.ts`) is exposed as JSON under `/api/v1/` and rendered natively.
- **`/api/v1/` is versioned** because App Store builds stay on phones for months; the web can change freely, but a v1 route only gains fields. A breaking change means a `/api/v2/` route.
- Each v1 route has vitest tests next to the server function it wraps, like the existing route tests (`src/lib/server/espn/*Route.test.ts`). The Swift side decodes the same JSON with `Codable` types and tests against recorded fixtures.
- **One season route feeds Game day and Lineup** (`GET /api/v1/leagues/[id]/season`, APE-379), the way one server page feeds both tabs on the web. Values the web derives inside its components (scoreboard status, bench order, `outTag`, start/sit swaps) live in pure functions in `src/lib/season/` that the web and the route share, so the app never re-implements season math.
- **Live scores are polled, not streamed.** While the matchup is live and the app is in the foreground, it re-fetches the season route every 60 seconds, the interval of the web's `useLivePolling.ts`; the server's 45-second ESPN cache keeps that cheap. The route's `live` object is the shape the Live Activity reuses.
- Gates carry over unchanged: `withUser()` (404 when cloud is off, 401 signed out), `config.espnSeasonEnabled` and `mayUseSeason()` for in-season features, and the AI entitlement checks in `src/lib/server/entitlements.ts`.
- **v2** runs the pure-TypeScript draft engine (`src/lib/draft/`, including the simulator) in **JavaScriptCore**, which ships with iOS: a build step bundles it into one JS file the app loads. One engine, no Swift rewrite.

## 4. Sign-in

Today's sign-in (Auth.js, `src/lib/auth/index.ts`) uses database sessions in a cookie, with Google OAuth and email magic links. Neither works as-is in an app: Google blocks OAuth inside embedded web views (`disallowed_useragent`), and a magic link opens in Mail and then Safari, not the app.

The plan:

1. **Sign in with Apple** becomes a provider on the web too. Apple requires it in any app that offers Google sign-in (guideline 4.8). Signing in with the same email as an existing account must land on that account; the ticket verifies how Auth.js links accounts.
2. **In the app**, all three ways open the system sign-in UI, never an embedded web view:
   - Apple: the native `ASAuthorizationAppleIDButton`.
   - Google: `ASWebAuthenticationSession` (the system browser sheet Google allows).
   - Email: the magic link is a **Universal Link** on `draftroom.online`, so tapping it in Mail opens the app. That needs an `apple-app-site-association` file served by the web app.
3. **A native token exchange endpoint** turns a completed sign-in into a session token. The app stores it in the Keychain and sends it as `Authorization: Bearer <token>`.
4. **`withUser()` accepts the Bearer token** as well as the cookie, resolving to the same `sessions` row, so every route the app calls is protected the same way. (`isSameOrigin()` already lets requests without an `Origin` header through, which is what native requests look like.)
5. **Account deletion** (`DELETE /api/v1/account`, plus a button in the web account menu): App Store guideline 5.1.1(v) requires it in any app with sign-up. It deletes the user, their leagues, their stored ESPN login and their device tokens.

### The sign-in endpoints (built in 17.4)

Every exchange ends the same way: a row in Auth.js's `sessions` table and `{ token, expiresAt, user, isNew }`. App sessions last 90 days and extend when used in their second half. All of this is in `src/lib/server/appAuth.ts`. The exchange endpoints allow 10 attempts a minute per address.

| Route | What it does |
|---|---|
| `POST /api/v1/auth/apple` | `{ identityToken, nonce, fullName? }`. Verifies the token against Apple's keys: issuer, audience `tech.apeman.draftroom`, expiry, and `sha256(nonce)`. Links to an existing account by verified email, like the web. |
| `GET /api/v1/auth/google` | Opened in an ephemeral `ASWebAuthenticationSession`. Runs the web's Google sign-in, then `/api/v1/auth/handoff` swaps that browser session for a 60-second single-use code and redirects to `https://draftroom.online/app/callback?code=…` (a Universal Link; `draftroom://auth/callback` on dev servers). |
| `POST /api/v1/auth/code` | `{ code }`. Trades the hand-off code for a session. |
| `POST /api/v1/auth/email/start` | `{ email }`. Sends the magic link, with `/app/signed-in` as its destination. That destination is what the Universal Link rule matches, so links asked for on the web keep opening the web. |
| `POST /api/v1/auth/email` | `{ email, token }`, taken from the opened link. Uses it up exactly as Auth.js would. |
| `POST /api/v1/auth/signout` | Deletes the Bearer token's session. |
| `GET /api/v1/me` | The user, feature flags (`season`, `ai`, `payments`) and `minAppVersion`. |

## 5. Connecting ESPN

```
app opens ESPN sign-in in a WKWebView ──▶ user signs in to ESPN (Disney OneID)
  ──▶ app reads espn_s2 + SWID from WKHTTPCookieStore ──▶ closes the web view
  ──▶ user picks their league ──▶ POST to the season connect path (connectSeason)
  ──▶ server verifies with ESPN, seals the login (secretBox), links the league
```

- The server side exists: `connectSeason()` in `src/lib/server/espn/seasonConnect.ts` verifies the cookies against the league, checks the user has a team, and stores them sealed with `storeLogin()` (`logins.ts`). The app needs a v1 route that accepts the same `ConnectRequest`.
- **Consent first.** The user sees the same ESPN disclosure the web shows (`src/lib/espn/disclosure.ts`) before the web view opens, and the request carries its `consentVersion`.
- **The cookies never touch disk in the app.** They go from the cookie store to the request and are dropped; the web view uses a non-persistent data store.
- **The 17.0 spike** confirms this on the test league before anything is built (other fantasy apps do this, so it is expected to work): the OneID login page works in a `WKWebView`, both cookies appear, and whether ESPN's fan API can list the user's leagues so they pick from a list instead of typing a league id.

## 6. Push notifications and the Live Activity

- **APNs directly** from the droplet over HTTP/2, authenticated with a `.p8` token key. No Firebase or third-party push service.
- A new `device_tokens` table (one row per device per user; removed on sign-out, account deletion, or when APNs says the token is dead).
- A new `pushEnabled` flag in `src/lib/config.ts`, on when the APNs env vars are set, with the vars added to `.env.example`, following the rule that the app boots with zero env vars.
- Alerts become channel-agnostic: each alert a user gets (v1: the ruled-out-starter alert from APE-347, and the lineup reminder) goes by email, push, or both, per their preference.
- **Game day Live Activity**: a lock-screen and Dynamic Island card with the live matchup score, updated by APNs `liveactivity` pushes from the season jobs. It is the last ticket before the external beta and the first cut if the date slips.

## 7. Design on iOS

- The tokens in the `@theme` block of `src/app/globals.css` are the single source. A script generates the Swift equivalents (colors, type scale, spacing) into `mobile/ios/`, and CI fails when the generated file is stale, so the two platforms never drift.
- Dark only, like the web.
- The delight moments in [`DESIGN.md`](../DESIGN.md) are rebuilt natively, not imitated: springs, haptics (`sensoryFeedback`), `matchedGeometryEffect`, Liquid Glass where the OS has it. Each screen ticket owns its own moments.
- Every UI ticket goes through an `/impeccable` pass, as on the web.
- **Share images are drawn natively** with `ImageRenderer` and the design tokens (the win card, the recap card), not rendered on the server; the API carries the content they show.
- **Accessibility in every UI ticket:** Dynamic Type up to the accessibility sizes, VoiceOver labels on scores and lineup slots, Reduce Motion turns celebrations into fades, and haptics follow the system setting.

## 8. Building and testing

- **Xcode** is required to build anything. Command Line Tools alone can't.
- Locally, agents build and test on the simulator:

  ```sh
  xcodebuild test -project mobile/ios/DraftRoom.xcodeproj -scheme DraftRoom \
    -destination 'platform=iOS Simulator,name=iPhone 17'
  ```

- **Tests:** Swift Testing for view models and the API client (against recorded JSON fixtures), plus one XCUITest smoke run: sign in, open Game day, open a lineup.
- **Xcode Cloud** (included with the developer membership, 25 compute hours a month) builds and tests every PR that touches `mobile/ios/**`, and uploads every `main` build to TestFlight. Signing happens in Apple's cloud, so no certificates or secrets go into GitHub. The web CI (`.github/workflows/ci.yml`) is unchanged.

## 9. First launch: from nothing to TestFlight

The steps a person has to do, in order. Each is its own `human` ticket in Epic 16 with the full click-by-click; this is the overview.

1. **Install Xcode** from the Mac App Store (~15 GB), open it once to install the iOS simulator, and run `sudo xcode-select -s /Applications/Xcode.app` so command-line builds use it.
2. **Find the D-U-N-S number.** Apple's lookup tool is at developer.apple.com → Account → enroll → "Check D-U-N-S Number"; the D&B report also shows it. Apple matches the legal entity name exactly, so use the LLC's registered name, not a trade name.
3. **Enroll in the Apple Developer Program as an Organization** ($99 a year) with an Apple ID on greg@apeman.tech. Apple may phone to verify you can sign for the company. It usually clears in a few days.
4. **App Store Connect:** register the bundle ID `tech.apeman.draftroom` with the capabilities Sign in with Apple, Push Notifications, Associated Domains and App Groups, then create the app record named "Draft Room".
5. **Keys:** create the APNs `.p8` key and the Sign in with Apple key and Services ID, and put them in `/etc/warroom/.env` on the droplet.
6. **Xcode Cloud:** connect it to the GitHub repo and turn on the workflows Epic 17 defines.
7. **TestFlight:**
   - **Internal testers** are people on your App Store Connect team (up to 100). Builds reach them minutes after upload, with **no review**. Use this from the first working build.
   - **External testers** (up to 10,000, by email or a public link) need a **beta review** of the first build of each version, usually about a day. Later builds of the same version usually skip it.
   - TestFlight builds expire after 90 days.
8. **The App Store itself** (after the beta) needs screenshots, the privacy "nutrition labels", a privacy policy URL, age rating, and a full review (usually one to two days, longer the first time).

## 10. App Review: what gets apps rejected

| Guideline | Risk for Draft Room | How we avoid it |
|---|---|---|
| 4.8 Sign in with Apple | Offering Google without Apple | Sign in with Apple in Epic 17 |
| 5.1.1(v) Account deletion | No way to delete an account in the app | `DELETE /api/v1/account` and a button in settings |
| 5.1.1 Privacy policy | None exists yet | A `/privacy` page on the web, disclosing that the ESPN login is stored sealed and deleted after the season (`loginExpiry()`) |
| 5.2 Intellectual property | ESPN names and marks | Text only, "Works with ESPN Fantasy"; no logos or colors |
| 2.1 App completeness | The reviewer can't get past sign-in without an ESPN league | A reviewer account that signs in with a fixed code and sees seeded season data from the test league, with ESPN writes stubbed. Credentials go in the review notes |
| 3.1.1 In-app purchase | Selling digital features through Stripe in the app | No purchase UI in v1 |
| 4.2 Minimum functionality | "It's just a website" | Native SwiftUI, push, Live Activity; no web content except ESPN's own sign-in page |

## 11. The epics

All in the Fantasy War Room project in Linear, related to APE-312. Each epic is one PR with one commit per ticket. Tickets labeled `human` are for a person and carry their own step-by-step instructions; agent tickets that depend on them are blocked by them.

| Epic | What |
|---|---|
| 16. iOS: Apple setup | Xcode, D-U-N-S, enrollment, App Store Connect, keys, Xcode Cloud, TestFlight groups (`human`) |
| 17. iOS: Foundation | ESPN login spike, Xcode project and Xcode Cloud workflows, token generator, Sign in with Apple, Bearer sessions, `/privacy`, account deletion, Universal Links, app sign-in, ESPN connect, app shell |
| 18. iOS: Game day, lineups, recaps | v1 routes and screens; ends with the first internal TestFlight build |
| 19. iOS: Team management | IR, add/drop, waivers and FAAB, using the Epic 13 consent |
| 20. iOS: AI | AI lineups and trade write-ups, gated by entitlement (full access in the beta) |
| 21. iOS: Push and Live Activity | Device tokens, APNs sender, alert preferences, the two v1 alerts, Game day Live Activity |
| 22. iOS: Beta release | Reviewer account and seeded data, privacy labels, review notes, external TestFlight |

## 12. Later: v2 and in-app purchase

- **v2, the draft room**, ports `src/components/draft/` to SwiftUI on top of the JavaScriptCore engine bundle ([§3](#3-how-it-fits-together)), and live-draft sync through the Epic 9 server client (`src/lib/server/espn/serverClients.ts`) using the ESPN login the app already has.
- **In-app purchase** replaces Stripe inside the app when pricing is decided (APE-342). Apple takes 15% under the Small Business Program. The server keeps one entitlement model (`entitlements.ts`), fed by both Stripe webhooks and App Store Server Notifications.
