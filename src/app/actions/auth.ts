"use server";

import { authjs } from "@/lib/auth";

/** Signs out and returns to the war room. */
export async function signOutAction(): Promise<void> {
  if (!authjs) return;
  await authjs.signOut({ redirectTo: "/" });
}
