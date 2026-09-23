"use client";

import { useState } from "react";
import { cx, s } from "./cx";
import { useEspnSync } from "./EspnSync";
import { useConfirm, useToast } from "./Feedback";

const TAKE_OVER_WARNING =
  "Your ESPN draft room will disconnect, on every device, and War Room becomes where you draft: from this screen or any other signed in to War Room. " +
  "You can hand back at any time. If something goes wrong, click Reconnect in ESPN and War Room steps back.";

/**
 * Taking over the user's ESPN draft connection, and giving it back (9.4). ESPN allows one connection
 * per team, so War Room joining the draft room disconnects the user's own; this bar says so before it
 * happens, says who holds the connection while War Room does, and says plainly when ESPN takes it back.
 * Nothing here reconnects on its own.
 */
export function EspnTakeover() {
  const { serverClient, status, serverClientAction, queuePlan } = useEspnSync();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!serverClient || status === "complete" || serverClient.state === "complete") return null;
  const { state } = serverClient;

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    const failed = await work();
    setBusy(false);
    if (failed) toast(failed);
  };

  const takeOver = async () => {
    const ok = await confirm({ message: TAKE_OVER_WARNING, confirmLabel: "Take over", cancelLabel: "Not now" });
    if (ok) await run(() => serverClientAction("take-over"));
  };
  const handBack = () => run(() => serverClientAction("hand-back"));

  if (state === "connecting") {
    return (
      <div className={s.espnArm} role="status">
        <span className={s.espnArmText}>
          {serverClient.reason ?? "Connecting to your ESPN draft room…"}
          <small>
            {serverClient.reason
              ? "Picks made meanwhile land on your board once it's back. If you're on the clock, ESPN autopicks from your queue."
              : "Your ESPN draft room will show “Duplicate Connection”. That's expected."}
          </small>
        </span>
      </div>
    );
  }

  if (state === "holding") {
    return (
      <div className={cx("espnArm", "espnHold")} role="region" aria-label="War Room is drafting for you">
        <span className={s.espnArmText}>
          War Room holds your ESPN connection
          <small>Draft here. Your ESPN draft room is disconnected until you hand back.</small>
        </span>
        <button
          className={s.btn}
          disabled={busy}
          onClick={() => run(() => queuePlan(!serverClient.queueSync))}
          aria-pressed={!!serverClient.queueSync}
          title="Keep ESPN's pick queue set to your turn plan, so ESPN's autopick takes your targets if War Room's connection drops on your turn. Replaces what you queued in ESPN."
        >
          {serverClient.queueSync ? "✓ ESPN queue follows plan" : "Queue my plan in ESPN"}
        </button>
        <button className={s.btn} disabled={busy} onClick={handBack}>
          Hand back
        </button>
      </div>
    );
  }

  if (state === "lost") {
    const key = serverClient.reason ?? "lost";
    if (dismissed === key) return null;
    return (
      <div className={s.espnArm} role="alert">
        <span className={s.espnArmText}>
          {serverClient.refused ? "War Room couldn't join your ESPN draft room" : "ESPN took the connection back"}
          <small>{serverClient.reason ?? "War Room's connection to ESPN ended."} War Room won&apos;t reconnect by itself.</small>
        </span>
        <button className={cx("btn", "espnGo")} disabled={busy} onClick={takeOver}>
          {serverClient.refused ? "Try again" : "Take over again"}
        </button>
        <button className={s.btn} onClick={() => setDismissed(key)}>
          Draft in ESPN
        </button>
      </div>
    );
  }

  // stored or released: a join code is on hand, and nothing is connected.
  if (dismissed === state) return null;
  return (
    <div className={s.espnArm} role="region" aria-label="Draft without your ESPN tab">
      <span className={s.espnArmText}>
        {state === "released" ? "You're drafting in ESPN again" : "Draft from here, with no ESPN tab open"}
        <small>War Room can hold your ESPN draft connection, so you can close ESPN and draft from your phone.</small>
      </span>
      <button className={cx("btn", "espnGo")} disabled={busy} onClick={takeOver}>
        {state === "released" ? "Take over again" : "Take over"}
      </button>
      <button className={s.btn} onClick={() => setDismissed(state)}>
        Not now
      </button>
    </div>
  );
}
