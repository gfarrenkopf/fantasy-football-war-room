"use client";

import { useEffect, useRef, useState } from "react";
import type { AlertChannel, AlertKind } from "@/lib/season/alerts";
import type { NotificationsResponse } from "@/lib/server/v1/notifications";
import s from "./appBar.module.css";

/**
 * The user's ESPN connection (Epic 15), opened from the account menu: one login reads every league,
 * so disconnecting and the season alerts are the account's, not any one league's. Moved here from the
 * foot of the season page. Reconnecting, or connecting another league, goes to the bookmark's
 * setup page (APE-335).
 */
export function EspnConnectionDialog({
  alerts,
  login,
  onClose,
}: {
  /** The season alerts are offered: the jobs run and can email or push. */
  alerts: boolean;
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
            {alerts && <Alerts />}
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

const CHANNEL_LABEL: Record<AlertChannel, string> = { email: "Email", push: "iPhone", both: "Email and iPhone", off: "Off" };

/**
 * Each season alert and how it reaches the user (21.3): email, a push to the iPhone app, both or
 * off. The iPhone choices appear once the user has the app; the app's settings show the same list.
 */
function Alerts() {
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/v1/notifications")
      .then((res) => (res.ok ? (res.json() as Promise<NotificationsResponse>) : null))
      .catch(() => null)
      .then((body) => live && (body ? setData(body) : setFailed(true)));
    return () => {
      live = false;
    };
  }, []);

  async function choose(kind: AlertKind, channel: AlertChannel) {
    if (!data) return;
    const before = data;
    setData({ ...data, alerts: data.alerts.map((a) => (a.kind === kind ? { ...a, channel } : a)) });
    setFailed(false);
    const res = await fetch("/api/v1/notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ alerts: { [kind]: channel } }) }).catch(() => null);
    if (res?.ok) setData((await res.json()) as NotificationsResponse);
    else {
      setData(before);
      setFailed(true);
    }
  }

  if (!data) return failed ? <p className={s.warnText}>Couldn&apos;t load your alerts. Try again later.</p> : null;
  const phone = data.push && data.hasDevice;
  const options = (current: AlertChannel) =>
    (["email", "push", "both", "off"] as const).filter((c) => c === current || c === "off" || ((c === "email" || c === "both") && data.email && (c === "email" || phone)) || (c === "push" && phone));
  return (
    <div className={s.alerts}>
      <h3 className={s.alertsTitle}>Alerts</h3>
      {data.alerts.map((a) => (
        <label key={a.kind} className={s.alertRow}>
          <span>
            <span className={s.alertName}>{a.title}</span>
            <span className={s.dialogText}>{a.detail}</span>
          </span>
          <select className={s.alertSelect} value={a.channel} onChange={(e) => choose(a.kind, e.target.value as AlertChannel)}>
            {options(a.channel).map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
      ))}
      {data.push && !data.hasDevice && <p className={s.dialogText}>Get these on your phone too: sign in to the Draft Room iPhone app.</p>}
      {failed && <span className={s.warnText}>Couldn&apos;t save that. Try again.</span>}
    </div>
  );
}
