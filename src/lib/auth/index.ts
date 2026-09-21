import "server-only";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import type { EmailConfig } from "next-auth/providers/email";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { config } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import { renderSignInEmail } from "./email";
import type { SessionUser } from "./types";

export type { SessionUser } from "./types";

function authConfig(): NextAuthConfig {
  const providers: NextAuthConfig["providers"] = [];
  if (config.googleAuthEnabled) providers.push(Google({ clientId: config.googleClientId, clientSecret: config.googleClientSecret }));
  if (config.emailAuthEnabled) providers.push(Resend({ name: "Email", apiKey: config.resendApiKey, from: config.emailFrom, sendVerificationRequest }));

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
    // successful sign-in follows its own redirectTo (`?welcome=1`).
    pages: { newUser: "/draft?welcome=new" },
    // In production, only trust the request's Host when NEXTAUTH_URL pins the public origin (see config warnings).
    trustHost: Boolean(config.nextAuthUrl) || !config.isProduction,
    // Auth.js renders its sign-in page outside the app, so it takes a literal color: --color-value from globals.css.
    theme: { colorScheme: "dark", brandColor: "#22c55e" },
    callbacks: {
      // Database sessions hand this the full session row (including its token); expose only what the app needs.
      session({ session, user }) {
        return { expires: session.expires, user: { id: user.id, email: user.email, name: user.name, image: user.image } } as typeof session;
      },
    },
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
