"use server";

import { AuthError } from "next-auth";
import { authjs } from "@/lib/auth";
import { config } from "@/lib/config";

/** Where every successful sign-in lands: the war room, with the user's leagues already synced. */
const AFTER_SIGN_IN = "/draft?welcome=1";

/** Ends the session. The caller reloads the page, so every store and provider starts fresh for the signed-out user. */
export async function signOutAction(): Promise<void> {
  if (!authjs) return;
  await authjs.signOut({ redirect: false });
}

export type EmailSignInResult = { ok: true } | { ok: false; reason: "unavailable" | "invalid-email" | "failed" };

/**
 * Sends a magic link, without navigating: the landing page swaps to its own "check your inbox"
 * state instead of handing the user to Auth.js's page.
 *
 * The result never says whether the address has an account — it reports only whether the mail
 * went out, so the form can't be used to probe for registered users.
 */
export async function signInWithEmail(email: string): Promise<EmailSignInResult> {
  if (!authjs || !config.emailAuthEnabled) return { ok: false, reason: "unavailable" };
  const address = email.trim().toLowerCase();
  // Deliberately loose: the mail provider is the real validator. This only catches obvious typos.
  if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { ok: false, reason: "invalid-email" };
  try {
    await authjs.signIn("resend", { email: address, redirect: false, redirectTo: AFTER_SIGN_IN });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, reason: "failed" };
    throw error;
  }
}

/** Starts the Google flow. This one really does redirect — OAuth has to leave the page. */
export async function signInWithGoogle(): Promise<void> {
  if (!authjs || !config.googleAuthEnabled) return;
  await authjs.signIn("google", { redirectTo: AFTER_SIGN_IN });
}
