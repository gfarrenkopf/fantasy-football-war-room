"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "./Account";
import { useToast } from "./Feedback";
import { useLeague } from "./LeagueProvider";

/**
 * Arriving somewhere that knows you just signed in. Auth.js sends every successful sign-in to
 * `?welcome=1`; ImportPrompt's "add this league to your account" dialog follows on its own when
 * leagues are waiting, and this line makes that arrive as arranged rather than abrupt. The
 * parameter is stripped the moment it's read, so a reload or a shared link never replays it.
 * (A league just created on the landing page, `?new=1`, gets OpeningNight instead.)
 */
export function WelcomeBack() {
  const user = useAccount();
  const { hydrated } = useLeague();
  const toast = useToast();
  const said = useRef(false);

  useEffect(() => {
    if (said.current || !hydrated) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("welcome") !== "1" || !user) return;
    said.current = true;
    url.searchParams.delete("welcome");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    toast(user.email ? `Signed in as ${user.email}. Your leagues are here.` : "Signed in. Your leagues are here.");
  }, [user, hydrated, toast]);

  return null;
}
