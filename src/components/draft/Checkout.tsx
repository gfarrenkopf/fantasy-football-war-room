"use client";

import { useEffect, useState } from "react";
import { getStores, type CheckoutResult } from "@/lib/storage";
import { useAccount } from "./Account";
import { cx } from "./cx";
import { useToast } from "./Feedback";
import { useFlags } from "./Flags";

const PROBLEMS: Record<Exclude<CheckoutResult, { ok: true }>["reason"], string> = {
  offline: "Can't reach the server right now. Try again in a moment.",
  "signed-out": "Sign in again to buy a season pass.",
  "not-found": "This league isn't in your account yet. Give it a moment to sync, then try again.",
  "already-paid": "This league already has a season pass.",
  unavailable: "Checkout isn't available right now. Try again in a moment.",
};

/**
 * "Buy season pass" for a league: sends the user to Stripe Checkout. Renders nothing unless payments
 * are on and the user is signed in.
 */
export function BuySeasonPass({ leagueId, label = "Buy season pass" }: { leagueId: string; label?: string }) {
  const flags = useFlags();
  const user = useAccount();
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const store = getStores().checkout;
  if (!flags.paymentsEnabled || !user || !store) return null;

  async function buy() {
    setStarting(true);
    const result = await store!.start(leagueId);
    if (result.ok) {
      window.location.assign(result.url); // stays "Opening checkout…" while the page leaves
      return;
    }
    setStarting(false);
    toast(PROBLEMS[result.reason]);
  }

  return (
    <button className={cx("btn", "primary")} onClick={buy} disabled={starting}>
      {starting ? "Opening checkout…" : label}
    </button>
  );
}

/**
 * Toasts the outcome when Stripe sends the user back (`?checkout=success|cancel`), then removes the
 * query so a reload doesn't repeat it. The purchase itself is recorded by the webhook, not this redirect.
 */
export function CheckoutReturn() {
  const toast = useToast();
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("checkout");
    if (outcome !== "success" && outcome !== "cancel") return;
    toast(outcome === "success" ? "Payment received. Your season pass will be active in a moment." : "Checkout canceled. You weren't charged.");
    url.searchParams.delete("checkout");
    url.searchParams.delete("league");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [toast]);
  return null;
}
