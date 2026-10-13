import "server-only";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Apple from "next-auth/providers/apple";
import type { EmailConfig } from "next-auth/providers/email";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { config } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import { appleDisplayName, cachedAppleClientSecret, storeAppleName } from "./apple";
import { renderSignInEmail } from "./email";
import type { SessionUser } from "./types";

export type { SessionUser } from "./types";

function authConfig(): NextAuthConfig {
  const providers: NextAuthConfig["providers"] = [];
  if (config.googleAuthEnabled) providers.push(Google({ clientId: config.googleClientId, clientSecret: config.googleClientSecret }));
  if (config.emailAuthEnabled) providers.push(Resend({ name: "Email", apiKey: config.resendApiKey, from: config.emailFrom, sendVerificationRequest }));
  if (config.appleAuthEnabled) providers.push(appleProvider());

  return {
    adapter: DrizzleAdapter(getDb(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
    }),
    providers,
    secret: config.nextAuthSecret,
    session: { strategy: "database" },
    // A first sign-in lands on the welcome card's new-account moment (see Welcome.tsx); every other
    // successful sign-in follows its own redirectTo (`?welcome=1`). A failed one (a used or expired
    // link) comes back to the war room as `?error=<code>`, where the sign-in dialog explains it.
    pages: { newUser: "/draft?welcome=new", error: "/draft" },
    // In production, only trust the request's Host when NEXTAUTH_URL pins the public origin (see config warnings).
    trustHost: Boolean(config.nextAuthUrl) || !config.isProduction,
    // Auth.js renders its sign-in page outside the app, so it takes a literal color: --color-value from globals.css.
    theme: { colorScheme: "dark", brandColor: "#22c55e" },
    cookies: appleCookies(),
    events: {
      // Apple names the user only on their first consent. A new account already got the name at
      // creation (the provider's profile); this covers an existing account linked by email.
      async linkAccount({ user, account, profile }) {
        if (account.provider === "apple" && user.id) await storeAppleName(getDb(), user.id, profile.name ?? null);
      },
    },
    callbacks: {
      // Database sessions hand this the full session row (including its token); expose only what the app needs.
      session({ session, user }) {
        return { expires: session.expires, user: { id: user.id, email: user.email, name: user.name, image: user.image } } as typeof session;
      },
    },
  };
}

/**
 * Sign in with Apple. Apple wants a freshly signed JWT as the client secret, not a static one
 * (see apple.ts), and sends the user's name only on first consent, as `profile.user`.
 *
 * Account linking: `allowDangerousEmailAccountLinking` lets an Apple sign-in land on the existing
 * account with the same email (made with Google or a magic link) instead of failing with
 * OAuthAccountNotLinked. Auth.js calls it dangerous because a provider that doesn't verify emails
 * would let anyone claim an account by typing its address. Apple only issues verified emails: an
 * Apple ID's address is confirmed before it can be used, and "Hide my email" gives a unique relay
 * address that matches no existing account (that user simply gets a new account, as expected).
 * That is the same trust the magic link already places in the inbox, so linking is safe here. It
 * is set on Apple only; Google keeps the default.
 */
function appleProvider() {
  return Apple({
    clientId: config.appleClientId,
    clientSecret: cachedAppleClientSecret({
      teamId: config.appleTeamId!,
      keyId: config.appleKeyId!,
      clientId: config.appleClientId!,
      privateKey: config.applePrivateKey!,
    }),
    allowDangerousEmailAccountLinking: true,
    // The default falls back to the email as the name; an unnamed account should stay unnamed.
    profile(profile) {
      return { id: profile.sub, name: appleDisplayName(profile.user?.name), email: profile.email, image: null };
    },
  });
}

/**
 * Apple returns to the callback with a cross-site POST (`response_mode=form_post`), and browsers
 * don't send SameSite=Lax cookies on those, so Auth.js would lose its state and nonce checks.
 * Those two short-lived cookies go out as SameSite=None, which browsers only accept over HTTPS;
 * Apple needs HTTPS anyway, so plain-HTTP dev servers keep the defaults.
 */
function appleCookies(): NextAuthConfig["cookies"] {
  if (!config.appleAuthEnabled || !config.nextAuthUrl?.startsWith("https://")) return undefined;
  const options = { httpOnly: true, sameSite: "none" as const, path: "/", secure: true, maxAge: 15 * 60 };
  return {
    state: { name: "__Secure-authjs.state", options },
    nonce: { name: "__Secure-authjs.nonce", options },
  };
}

/**
 * Sends the magic link as the war room's own email (see email.ts), through Resend's API the way
 * the built-in provider does. The account lookup only changes the greeting in the requester's own
 * inbox; nothing about it reaches the form, so the form still can't probe for registered users.
 */
const sendVerificationRequest: EmailConfig["sendVerificationRequest"] = async ({ identifier, url, provider }) => {
  const existing = await getDb()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, identifier))
    .limit(1)
    .catch(() => null);
  const { subject, html, text } = renderSignInEmail({
    url,
    email: identifier,
    // A failed lookup reads as returning: that copy is true for everyone.
    isNew: existing !== null && existing.length === 0,
    hours: Math.round((provider.maxAge ?? 24 * 60 * 60) / 3600),
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: provider.from, to: identifier, subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend error: ${res.status} ${await res.text()}`);
};

/**
 * Auth.js, or null when cloud features are off. The config is built per request, so importing
 * this module never opens a database connection (the app builds and boots with no env vars).
 */
export const authjs = config.cloudEnabled ? NextAuth(() => authConfig()) : null;

/** The signed-in user for the current request, or null (signed out, or cloud features off). */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!authjs) return null;
  const session = await authjs.auth();
  const id = session?.user?.id;
  return id ? { userId: id, email: session.user?.email ?? null } : null;
}
