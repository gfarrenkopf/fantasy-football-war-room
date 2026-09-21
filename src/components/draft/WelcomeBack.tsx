"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "./Account";
import { useToast } from "./Feedback";
import { useLeague } from "./LeagueProvider";

const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
};

/**
 * Arriving somewhere that knows how you got here. Two one-time greetings, each set by the door:
 *
 * - `?welcome=1` — Auth.js sends every successful sign-in here. ImportPrompt's "add this league to
 *   your account" dialog follows on its own when leagues are waiting; this line makes that arrive
 *   as arranged rather than abrupt.
 * - `?new=1` — the landing page just created this league. One line says what to do first, in the
 *   room itself, where the advice is true: context over ceremony, no tour.
 *
 * Either parameter is stripped the moment it's read, so a reload or a shared link never replays it.
 */
export function WelcomeBack() {
  const user = useAccount();
  const { active, hydrated } = useLeague();
  const toast = useToast();
  const said = useRef(false);

  useEffect(() => {
    if (said.current || !hydrated) return;
    const url = new URL(window.location.href);
    const welcome = url.searchParams.get("welcome") === "1" && !!user;
    const fresh = url.searchParams.get("new") === "1" && !!active;
    if (!welcome && !fresh) return;
    said.current = true;
    url.searchParams.delete("welcome");
    url.searchParams.delete("new");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (welcome) {
      toast(user?.email ? `Signed in as ${user.email}. Your leagues are here.` : "Signed in. Your leagues are here.");
    } else if (active) {
      const { teams, mySlot } = active.settings;
      toast(`${teams}-team draft ready, you pick ${ordinal(mySlot)}. Log each pick as it goes off the board.`);
    }
  }, [user, active, hydrated, toast]);

  return null;
}
