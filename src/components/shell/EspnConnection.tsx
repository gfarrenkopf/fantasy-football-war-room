"use client";

import { useEffect, useRef, useState } from "react";
import s from "./appBar.module.css";

/**
 * The user's ESPN connection (Epic 15), opened from the account menu: one login reads every league,
 * so disconnecting and the Sunday email are the account's, not any one league's. Moved here from the
 * foot of the season page. Reconnecting, or connecting another league, goes to the bookmark's
 * setup page (APE-335).
 */
export function EspnConnectionDialog({
  seasonEmails,
  login,
  onClose,
}: {
  seasonEmails: boolean | null;
  /** ESPN still accepts the login, or has signed Draft Room out and it needs the bookmark again. */
  login: "connected" | "disconnected";
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<"idle" | "confirm" | "working" | "done" | "failed">("idle");
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function disconnect() {
    setPhase("working");
    const res = await fetch("/api/espn/login", { method: "DELETE" }).catch(() => null);
    setPhase(res?.ok ? "done" : "failed");
  }

  return (
    <dialog ref={ref} className={s.dialog} aria-labelledby="espn-connection-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <div className={s.dialogBody}>
        <h2 id="espn-connection-title" className={s.dialogTitle}>
          ESPN connection
        </h2>
        {phase === "done" ? (
          <p role="status">Disconnected. Draft Room has deleted your ESPN login, and your leagues stop updating until you connect again.</p>
        ) : (
          <>
            {login === "disconnected" ? (
              <p className={s.dialogText}>
                <span className={s.warnText}>ESPN signed Draft Room out</span>, which it does every so often. Your leagues stop updating until you reconnect.
              </p>
            ) : (
              <p className={s.dialogText}>Draft Room reads all your ESPN leagues with one login.</p>
            )}
            <p className={s.dialogText}>
              <a className={s.textBtn} href="/espn?for=season">
                {login === "disconnected" ? "Reconnect ESPN" : "Connect another ESPN league"}
              </a>
            </p>
            {seasonEmails !== null && <SeasonEmails initial={seasonEmails} />}
            <div className={s.dialogDanger}>
              {phase === "confirm" || phase === "working" ? (
                <>
                  <p>Delete your ESPN login from Draft Room? Every league stops updating until you connect again.</p>
                  <div className={s.dialogActions}>
                    <button type="button" className={`${s.textBtn} ${s.dangerBtn}`} disabled={phase === "working"} onClick={disconnect}>
                      Disconnect ESPN
                    </button>
                    <button type="button" className={s.textBtn} onClick={() => setPhase("idle")}>
                      Keep it
                    </button>
                  </div>
                </>
              ) : (
                <div className={s.dialogActions}>
                  <button type="button" className={s.textBtn} onClick={() => setPhase("confirm")}>
                    Disconnect ESPN…
                  </button>
                  {phase === "failed" && <span className={s.warnText}>Couldn&apos;t disconnect. Try again.</span>}
                </div>
              )}
            </div>
          </>
        )}
        <div className={s.dialogFoot}>
          <button type="button" className={s.textBtn} onClick={() => ref.current?.close()} autoFocus>
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** The Sunday job's email (11.3): on unless the user turns it off here or from the email. */
function SeasonEmails({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [failed, setFailed] = useState(false);
  async function toggle(next: boolean) {
    setOn(next);
    setFailed(false);
    const res = await fetch("/api/season/emails", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: next }) }).catch(() => null);
    if (!res?.ok) {
      setOn(!next);
      setFailed(true);
    }
  }
  return (
    <p className={s.dialogText}>
      <label className={s.checkRow}>
        <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} /> Email me when my Sunday AI lineup is ready
      </label>
      {failed && <span className={s.warnText}> Couldn&apos;t save that. Try again.</span>}
    </p>
  );
}
