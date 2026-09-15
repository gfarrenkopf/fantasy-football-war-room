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
const anthropicApiKey = readEnv("ANTHROPIC_API_KEY");
const stripeSecretKey = readEnv("STRIPE_SECRET_KEY");
const sportsDataApiKey = readEnv("SPORTSDATA_API_KEY");

/** Accounts + server-backed persistence. Requires a database and auth. */
const cloudEnabled = Boolean(databaseUrl && nextAuthSecret);

export const config = Object.freeze({
  databaseUrl,
  nextAuthSecret,
  nextAuthUrl,
  anthropicApiKey,
  stripeSecretKey,
  sportsDataApiKey,

  cloudEnabled,
  /** AI-generated draft plan. A paid, hosted feature, so it needs accounts. */
  aiEnabled: cloudEnabled && Boolean(anthropicApiKey),
  /** Stripe checkout + entitlements. Needs accounts to attach purchases to. */
  paymentsEnabled: cloudEnabled && Boolean(stripeSecretKey),
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
if (anthropicApiKey && !cloudEnabled) {
  warnings.push("ANTHROPIC_API_KEY is set but cloud features are disabled, so the AI plan is off.");
}
if (stripeSecretKey && !cloudEnabled) {
  warnings.push("STRIPE_SECRET_KEY is set but cloud features are disabled, so payments are off.");
}
for (const warning of warnings) {
  console.warn(`[config] ${warning}`);
}
