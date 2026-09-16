import "server-only";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { config } from "@/lib/config";
import { getDb, schema } from "@/lib/db";
import type { SessionUser } from "./types";

export type { SessionUser } from "./types";

function authConfig(): NextAuthConfig {
  const providers: NextAuthConfig["providers"] = [];
  if (config.googleAuthEnabled) providers.push(Google({ clientId: config.googleClientId, clientSecret: config.googleClientSecret }));
  if (config.emailAuthEnabled) providers.push(Resend({ name: "Email", apiKey: config.resendApiKey, from: config.emailFrom }));

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
