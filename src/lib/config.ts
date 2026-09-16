import "server-only";

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

const databaseUrl = readEnv("DATABASE_URL");
const nextAuthSecret = readEnv("NEXTAUTH_SECRET");
const nextAuthUrl = readEnv("NEXTAUTH_URL");
const googleClientId = readEnv("AUTH_GOOGLE_ID");
const googleClientSecret = readEnv("AUTH_GOOGLE_SECRET");
const resendApiKey = readEnv("AUTH_RESEND_KEY");
const emailFrom = readEnv("EMAIL_FROM");
const isProduction = process.env.NODE_ENV === "production";
const anthropicApiKey = readEnv("ANTHROPIC_API_KEY");
/** Which model provider writes the AI plan (see src/lib/ai/providers), and optionally which of its models. */
const aiProvider = readEnv("AI_PROVIDER") ?? "anthropic";
const aiModel = readEnv("AI_MODEL");
/** Comma-separated emails allowed to generate AI plans until payments gate them. Empty = every signed-in user. */
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

/** Accounts + server-backed persistence. Requires a database and auth. */
const cloudEnabled = Boolean(databaseUrl && nextAuthSecret);
/** Sign-in methods. Each needs cloud features plus its own credentials. */
const googleAuthEnabled = cloudEnabled && Boolean(googleClientId && googleClientSecret);
const emailAuthEnabled = cloudEnabled && Boolean(resendApiKey && emailFrom);
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
  resendApiKey,
  emailFrom,
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

  cloudEnabled,
  googleAuthEnabled,
  emailAuthEnabled,
  /** AI-generated draft plan. A paid, hosted feature, so it needs accounts. */
  aiEnabled: cloudEnabled && Boolean(aiApiKey),
  /** Stripe checkout + entitlements. Needs accounts to attach purchases to. */
  paymentsEnabled: cloudEnabled && stripeMissing.length === 0,
  /** Live ADP/projections ingestion. Without it the app uses the bundled sample data. */
  dataPipelineEnabled: Boolean(sportsDataApiKey),
});

export type Config = typeof config;

/** Booleans only, safe to pass from server components to client components as props. */
export const publicFlags = Object.freeze({
  cloudEnabled: config.cloudEnabled,
  aiEnabled: config.aiEnabled,
  paymentsEnabled: config.paymentsEnabled,
  dataPipelineEnabled: config.dataPipelineEnabled,
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
if (cloudEnabled && !googleAuthEnabled && !emailAuthEnabled) {
  warnings.push("Cloud features are enabled but no sign-in method is configured: set AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET or AUTH_RESEND_KEY/EMAIL_FROM.");
}
if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
  warnings.push("Only one of AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET is set, so Google sign-in is off.");
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
for (const warning of warnings) {
  console.warn(`[config] ${warning}`);
}
