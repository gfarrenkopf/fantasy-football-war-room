"use server";

import { authjs } from "@/lib/auth";

/** Ends the session. The caller reloads the page, so every store and provider starts fresh for the signed-out user. */
export async function signOutAction(): Promise<void> {
  if (!authjs) return;
  await authjs.signOut({ redirect: false });
}
