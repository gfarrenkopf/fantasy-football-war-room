import "server-only";
import { createPrivateKey } from "node:crypto";
import { parseKey } from "@/lib/server/espn/secretBox";

/**
 * The only module allowed to read `process.env` (enforced by ESLint).
 *
 * The app must boot with zero env vars: that's the self-hosted, free tier.
 * Hosted features switch on when their credentials are present.
 * See `.env.example` for what each variable does.
 */

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function isPrivateKey(pem: string): boolean {
  try {
    return createPrivateKey(pem).asymmetricKeyType === "ec";
  } catch {
    return false;
  }
}

const databaseUrl = readEnv("DATABASE_URL");
const nextAuthSecret = readEnv("NEXTAUTH_SECRET");
const nextAuthUrl = readEnv("NEXTAUTH_URL");
const googleClientId = readEnv("AUTH_GOOGLE_ID");
const googleClientSecret = readEnv("AUTH_GOOGLE_SECRET");
/**
 * Sign in with Apple on the web: the Services ID, the developer team id, and the Sign in with Apple
 * key (its id and its .p8 contents). The key signs the client secret Apple asks for (src/lib/auth/apple.ts).
 */
const appleClientId = readEnv("AUTH_APPLE_ID");
const appleTeamId = readEnv("AUTH_APPLE_TEAM_ID");
const appleKeyId = readEnv("AUTH_APPLE_KEY_ID");
/** The .p8 file's PEM. One line in .env files, so `\n` escapes stand for its line breaks. */
const applePrivateKeyRaw = readEnv("AUTH_APPLE_PRIVATE_KEY")?.replace(/\\n/g, "\n").trim();
const applePrivateKey = applePrivateKeyRaw && isPrivateKey(applePrivateKeyRaw) ? applePrivateKeyRaw : undefined;
/**
 * Push notifications to the iPhone app (21.2), sent straight to APNs: the APNs key's id, the
 * developer team id, the key's .p8 contents and the app's bundle ID.
 */
const apnsKeyId = readEnv("APNS_KEY_ID");
const apnsTeamId = readEnv("APNS_TEAM_ID");
/** The .p8 file's PEM, with `\n` escapes for line breaks like AUTH_APPLE_PRIVATE_KEY. */
const apnsPrivateKeyRaw = readEnv("APNS_PRIVATE_KEY")?.replace(/\\n/g, "\n").trim();
const apnsPrivateKey = apnsPrivateKeyRaw && isPrivateKey(apnsPrivateKeyRaw) ? apnsPrivateKeyRaw : undefined;
const apnsBundleId = readEnv("APNS_BUNDLE_ID") ?? "tech.apeman.draftroom";
const resendApiKey = readEnv("AUTH_RESEND_KEY");
const emailFrom = readEnv("EMAIL_FROM");
/** Shared with the droplet's timers: authorizes the internal job routes (src/app/api/internal). */
const cronSecret = readEnv("CRON_SECRET");
const isProduction = process.env.NODE_ENV === "production";
const anthropicApiKey = readEnv("ANTHROPIC_API_KEY");
/** Which model provider writes the AI plan (see src/lib/ai/providers), and optionally which of its models. */
const aiProvider = readEnv("AI_PROVIDER") ?? "anthropic";
const aiModel = readEnv("AI_MODEL");
/**
 * Comma-separated emails. Payments off: only these may generate AI plans (empty = every signed-in user).
 * Payments on: these skip the season pass paywall (empty = nobody does).
 */
const aiAllowlist = (readEnv("AI_ALLOWLIST") ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const stripeSecretKey = readEnv("STRIPE_SECRET_KEY");
/** Signs the events Stripe sends to /api/stripe/webhook. */
const stripeWebhookSecret = readEnv("STRIPE_WEBHOOK_SECRET");
/** The one-time price of a league's season pass. */
const stripePriceId = readEnv("STRIPE_PRICE_ID");
const sportsDataApiKey = readEnv("SPORTSDATA_API_KEY");
/**
 * Comma-separated emails. When set, only these accounts get ESPN live draft sync (the beta),
 * season pass or not. Empty: payments decide (season pass), or everyone when payments are off.
 * In-season help has its own switch, SEASON_ACCESS.
 */
const espnSyncAllowlist = (readEnv("ESPN_SYNC_ALLOWLIST") ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
/**
 * Who may use in-season help (APE-341): `open` (the default) is every signed-in account; `closed` is
 * SEASON_ALLOWLIST plus the accounts that joined while it was open, or were invited by hand.
 */
const seasonAccessRaw = readEnv("SEASON_ACCESS")?.toLowerCase();
const seasonAccess: "open" | "closed" = seasonAccessRaw === "closed" ? "closed" : "open";
/** Comma-separated emails let into in-season help while SEASON_ACCESS is closed. */
const seasonAllowlist = (readEnv("SEASON_ALLOWLIST") ?? "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
/**
 * 32 random bytes, base64. Encrypts the ESPN credentials a user hands War Room: the draft room's join
 * code, so it can draft for them without their ESPN tab open (Epic 9), and their ESPN login, so it
 * can read their leagues during the season (Epic 10). Without it both are off; the bookmarklet still
 * works for live draft sync.
 */
const espnCodeKeyRaw = readEnv("ESPN_CODE_KEY");
/**
 * Which landing page `/` shows (APE-340): `auto` (the default) follows the NFL season, `draft` or
 * `season` force one. The season page needs in-season features, so without them it's the draft page.
 */
const landingModeRaw = readEnv("LANDING_MODE")?.toLowerCase();
const landingMode = landingModeRaw === "draft" || landingModeRaw === "season" ? landingModeRaw : "auto";
const espnCodeKey = parseKey(espnCodeKeyRaw);

/** Accounts + server-backed persistence. Requires a database and auth. */
const cloudEnabled = Boolean(databaseUrl && nextAuthSecret);
/** Sign-in methods. Each needs cloud features plus its own credentials. */
const googleAuthEnabled = cloudEnabled && Boolean(googleClientId && googleClientSecret);
const emailAuthEnabled = cloudEnabled && Boolean(resendApiKey && emailFrom);
const appleVars = { AUTH_APPLE_ID: appleClientId, AUTH_APPLE_TEAM_ID: appleTeamId, AUTH_APPLE_KEY_ID: appleKeyId, AUTH_APPLE_PRIVATE_KEY: applePrivateKeyRaw };
const appleMissing = Object.keys(appleVars).filter((name) => !appleVars[name as keyof typeof appleVars]);
const appleAuthEnabled = cloudEnabled && appleMissing.length === 0 && applePrivateKey !== undefined;
const apnsVars = { APNS_KEY_ID: apnsKeyId, APNS_TEAM_ID: apnsTeamId, APNS_PRIVATE_KEY: apnsPrivateKeyRaw };
const apnsMissing = Object.keys(apnsVars).filter((name) => !apnsVars[name as keyof typeof apnsVars]);
/** API key per AI provider. Add a provider here when it gets an adapter in src/lib/ai/providers. */
const aiApiKeys: Record<string, { env: string; key: string | undefined }> = {
  anthropic: { env: "ANTHROPIC_API_KEY", key: anthropicApiKey },
};
const aiProviderKnown = Object.hasOwn(aiApiKeys, aiProvider);
const aiApiKey = aiProviderKnown ? aiApiKeys[aiProvider].key : undefined;
/** Payments need all three: a key alone could start checkouts the webhook can never grant. */
const stripeVars = { STRIPE_SECRET_KEY: stripeSecretKey, STRIPE_WEBHOOK_SECRET: stripeWebhookSecret, STRIPE_PRICE_ID: stripePriceId };
const stripeMissing = Object.keys(stripeVars).filter((name) => !stripeVars[name as keyof typeof stripeVars]);
const stripeAnySet = stripeMissing.length < Object.keys(stripeVars).length;

export const config = Object.freeze({
  databaseUrl,
  nextAuthSecret,
  nextAuthUrl,
  googleClientId,
  googleClientSecret,
  appleClientId,
  appleTeamId,
  appleKeyId,
  applePrivateKey,
  apnsKeyId,
  apnsTeamId,
  apnsPrivateKey,
  apnsBundleId,
  resendApiKey,
  emailFrom,
  cronSecret,
  isProduction,
  anthropicApiKey,
  aiProvider,
  aiModel,
  /** The configured AI provider's API key. */
  aiApiKey,
  aiAllowlist,
  stripeSecretKey,
  stripeWebhookSecret,
  stripePriceId,
  sportsDataApiKey,
  espnSyncAllowlist,
  seasonAccess,
  seasonAllowlist,
  espnCodeKey,
  landingMode,

  cloudEnabled,
  googleAuthEnabled,
  emailAuthEnabled,
  appleAuthEnabled,
  /** AI-generated draft plan. A paid, hosted feature, so it needs accounts. */
  aiEnabled: cloudEnabled && Boolean(aiApiKey),
  /** Stripe checkout + entitlements. Needs accounts to attach purchases to. */
  paymentsEnabled: cloudEnabled && stripeMissing.length === 0,
  /** Live ADP/projections ingestion. Without it the app uses the bundled sample data. */
  dataPipelineEnabled: Boolean(sportsDataApiKey),
  /**
   * ESPN live draft sync: picks relayed from a bridge in the user's ESPN tab. Needs accounts (picks
   * are relayed per user and league) and nothing else. Live sync itself stores no ESPN cookies or
   * passwords; the in-season login below is a separate opt-in.
   */
  espnSyncEnabled: cloudEnabled,
  /**
   * Drafting without an ESPN tab open (Epic 9): the user hands over their draft room's join code,
   * stored encrypted until the draft completes, and War Room joins ESPN's draft socket itself.
   */
  espnServerClientEnabled: cloudEnabled && espnCodeKey !== null,
  /**
   * In-season lineups and trades (Epic 10): the user hands over their ESPN login cookies once, stored
   * encrypted until the season ends or they disconnect, and War Room reads their leagues each week.
   */
  espnSeasonEnabled: cloudEnabled && espnCodeKey !== null,
  /**
   * The season jobs, started by timers on the droplet: the Sunday AI lineup (Epic 11, 11.3, which
   * also needs AI) and the early-kickoff alert (11.4). Need in-season and the shared job secret;
   * without Resend the Sunday job still writes lineups, and no alerts go out.
   */
  seasonJobEnabled: cloudEnabled && espnCodeKey !== null && Boolean(cronSecret),
  /** Push notifications to the iPhone app, sent to APNs. Needs accounts (device tokens are per user) and the APNs key. */
  pushEnabled: cloudEnabled && apnsMissing.length === 0 && apnsPrivateKey !== undefined,
});

export type Config = typeof config;

/** Booleans only, safe to pass from server components to client components as props. */
export const publicFlags = Object.freeze({
  cloudEnabled: config.cloudEnabled,
  /** Which sign-in methods exist, so the landing page never renders a button that 404s. */
  googleAuthEnabled: config.googleAuthEnabled,
  emailAuthEnabled: config.emailAuthEnabled,
  appleAuthEnabled: config.appleAuthEnabled,
  aiEnabled: config.aiEnabled,
  paymentsEnabled: config.paymentsEnabled,
  dataPipelineEnabled: config.dataPipelineEnabled,
  espnSyncEnabled: config.espnSyncEnabled,
  espnServerClientEnabled: config.espnServerClientEnabled,
  espnSeasonEnabled: config.espnSeasonEnabled,
  /** In-season help is open to every account (SEASON_ACCESS), not invite-only: the landing page may advertise it. */
  espnSeasonOpen: config.espnSeasonEnabled && config.seasonAccess === "open",
});

export type PublicFlags = typeof publicFlags;

// Warn (never throw) about partial setups that would otherwise silently leave a feature off.
const warnings: string[] = [];
if (databaseUrl && !nextAuthSecret) {
  warnings.push("DATABASE_URL is set but NEXTAUTH_SECRET is not, so cloud features are disabled.");
}
if (nextAuthSecret && !databaseUrl) {
  warnings.push("NEXTAUTH_SECRET is set but DATABASE_URL is not, so cloud features are disabled.");
}
if (cloudEnabled && !googleAuthEnabled && !emailAuthEnabled && !appleAuthEnabled) {
  warnings.push("Cloud features are enabled but no sign-in method is configured: set AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET, AUTH_RESEND_KEY/EMAIL_FROM or the AUTH_APPLE_* variables.");
}
if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
  warnings.push("Only one of AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET is set, so Google sign-in is off.");
}
if (appleMissing.length > 0 && appleMissing.length < Object.keys(appleVars).length) {
  warnings.push(`${appleMissing.join(", ")} ${appleMissing.length > 1 ? "are" : "is"} not set, so Sign in with Apple is off.`);
} else if (applePrivateKeyRaw && !applePrivateKey) {
  warnings.push("AUTH_APPLE_PRIVATE_KEY isn't the PEM of a Sign in with Apple .p8 key, so Sign in with Apple is off.");
}
if (apnsMissing.length > 0 && apnsMissing.length < Object.keys(apnsVars).length) {
  warnings.push(`${apnsMissing.join(", ")} ${apnsMissing.length > 1 ? "are" : "is"} not set, so push notifications are off.`);
} else if (apnsPrivateKeyRaw && !apnsPrivateKey) {
  warnings.push("APNS_PRIVATE_KEY isn't the PEM of an APNs .p8 key, so push notifications are off.");
} else if (apnsMissing.length === 0 && !cloudEnabled) {
  warnings.push("The APNS_* variables are set but cloud features are disabled, so push notifications are off.");
}
if (Boolean(resendApiKey) !== Boolean(emailFrom)) {
  warnings.push("Only one of AUTH_RESEND_KEY and EMAIL_FROM is set, so email sign-in is off.");
}
if (cloudEnabled && isProduction && !nextAuthUrl) {
  warnings.push("NEXTAUTH_URL is not set, so sign-in will reject requests in production. Set it to the site's public URL.");
}
if (!aiProviderKnown) {
  warnings.push(`AI_PROVIDER "${aiProvider}" isn't supported (known: ${Object.keys(aiApiKeys).join(", ")}), so the AI plan is off.`);
} else if (cloudEnabled && !aiApiKey && readEnv("AI_PROVIDER")) {
  warnings.push(`AI_PROVIDER is "${aiProvider}" but ${aiApiKeys[aiProvider].env} is not set, so the AI plan is off.`);
}
if (aiApiKey && !cloudEnabled) {
  warnings.push(`${aiApiKeys[aiProvider].env} is set but cloud features are disabled, so the AI plan is off.`);
}
if (stripeAnySet && !cloudEnabled) {
  warnings.push("Stripe variables are set but cloud features are disabled, so payments are off.");
} else if (stripeAnySet && stripeMissing.length) {
  warnings.push(`${stripeMissing.join(" and ")} ${stripeMissing.length > 1 ? "are" : "is"} not set, so payments are off.`);
}
if (espnSyncAllowlist.length && !cloudEnabled) {
  warnings.push("ESPN_SYNC_ALLOWLIST is set but cloud features are disabled, so ESPN live sync is off.");
}
if (espnCodeKeyRaw && !espnCodeKey) {
  warnings.push("ESPN_CODE_KEY isn't 32 bytes of base64 (try `openssl rand -base64 32`), so drafting without an ESPN tab open and in-season features are off.");
} else if (espnCodeKey && !cloudEnabled) {
  warnings.push("ESPN_CODE_KEY is set but cloud features are disabled, so drafting without an ESPN tab open and in-season features are off.");
}
if (seasonAccessRaw && seasonAccessRaw !== seasonAccess) {
  warnings.push(`SEASON_ACCESS "${seasonAccessRaw}" isn't open or closed, so in-season help is open to everyone.`);
}
if (seasonAllowlist.length && seasonAccess === "open") {
  warnings.push("SEASON_ALLOWLIST is set but SEASON_ACCESS is open, so the list does nothing: in-season help is open to everyone.");
}
if (landingModeRaw && landingModeRaw !== landingMode) {
  warnings.push(`LANDING_MODE "${landingModeRaw}" isn't one of auto, draft or season, so the landing page follows the season.`);
}
for (const warning of warnings) {
  console.warn(`[config] ${warning}`);
}
