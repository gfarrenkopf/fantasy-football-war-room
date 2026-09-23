"use client";

import { useEffect, useState } from "react";
import { cx, s } from "./cx";
import { useEspnSync } from "./EspnSync";
import { useToast } from "./Feedback";

/** How long to wait for ESPN to confirm autopick is off before saying it didn't take. */
const CONFIRM_MS = 6_000;

/**
 * ESPN has autopick on for the user's team, so ESPN, not the user, makes their picks: it drafts the
 * moment they're on the clock. ESPN switches it on by itself after a turn runs out and leaves it on,
 * which is easy to miss mid-draft. So this is the loudest thing on the screen until it's off.
 *
 * While War Room holds the ESPN connection, ESPN's own toggle is out of reach, so it's one tap here.
 * Otherwise the toggle is in the user's ESPN tab, and this says where.
 */
export function EspnAutopickAlert() {
  const { autopick } = useEspnSync();
  // Mounted only while it's on, so each time ESPN switches it on starts fresh.
  return autopick ? <AutopickOn /> : null;
}

function AutopickOn() {
  const { serverClient, turnOffAutopick, myTurn } = useEspnSync();
  const toast = useToast();
  const [sentAt, setSentAt] = useState<number | null>(null);

  // When it appears, a phone on the table buzzes, so it's noticed without looking.
  useEffect(() => void navigator.vibrate?.([120, 80, 120]), []);

  // Asked ESPN to turn it off and it still says on: say so, and offer the button again.
  useEffect(() => {
    if (sentAt === null) return;
    const id = setTimeout(() => {
      setSentAt(null);
      toast("ESPN didn't turn autopick off. Try again.");
    }, CONFIRM_MS);
    return () => clearTimeout(id);
  }, [sentAt, toast]);

  const holding = serverClient?.state === "holding";
  const turningOff = sentAt !== null;

  const turnOff = async () => {
    setSentAt(Date.now());
    const failed = await turnOffAutopick();
    if (failed) {
      setSentAt(null);
      toast(failed);
    }
  };

  return (
    <div className={s.espnAuto} role="alert">
      <svg className={s.espnAutoIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5 22 20.5H2L12 3.5Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 10v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="17.25" r="1.25" fill="currentColor" />
      </svg>
      <span className={s.espnAutoText}>
        <strong>{myTurn ? "ESPN is picking for you right now" : "ESPN is making your picks"}</strong>
        <span>
          Autopick is on for your team, so ESPN drafts the moment you&apos;re on the clock, before you can.
          {holding ? "" : " Turn it off in your ESPN draft room: Pick Queue, then Autopick."}
        </span>
      </span>
      {holding && (
        <button className={cx("btn", "espnAutoOff")} onClick={turnOff} disabled={turningOff}>
          {turningOff ? "Turning off…" : "Turn off autopick"}
        </button>
      )}
    </div>
  );
}
