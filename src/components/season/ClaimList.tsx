"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import type { SeasonView, ViewClaim } from "@/lib/season/view";
import { LocalTime } from "./LocalTime";
import s from "./season.module.css";
import { WriteConsent } from "./WriteConsent";

/**
 * The user's waiver claims pending on ESPN (13.4), each cancellable. Cancelling is a write like any
 * other: confirmed, re-read before and after on the server.
 */
export function ClaimList({ view, leagueId, agreed: agreedAtLoad, onNotice }: { view: SeasonView; leagueId: string; agreed: boolean; onNotice: (message: string) => void }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(agreedAtLoad);
  const [consenting, setConsenting] = useState(false);
  const names = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
  if (!view.claims.length) return null;

  async function cancel(claim: ViewClaim) {
    setSending(true);
    setFailed(null);
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/acquire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "cancel", week: view.currentWeek, claimId: claim.id, ...(agreed ? {} : { consentVersion: ESPN_WRITE_VERSION }) }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string; cancelled?: boolean; consent?: unknown; problems?: string[]; refused?: string[] } | undefined;
    setSending(false);
    if (res?.ok && typeof body?.cancelled === "boolean") {
      setConfirming(null);
      router.refresh();
      return onNotice(body.cancelled ? `Claim for ${claim.add.name} cancelled.` : `ESPN still shows your claim for ${claim.add.name}. Check ESPN. Draft Room has been alerted.`);
    }
    if (body?.consent) {
      setAgreed(false);
      return setConsenting(false);
    }
    if (res && (res.status === 409 || res.status === 502)) setAgreed(true);
    setFailed([body?.error ?? "Can't reach Draft Room right now. Nothing was sent to ESPN.", ...(body?.problems ?? body?.refused ?? [])].join(" "));
  }

  return (
    <div className={s.claims}>
      <p className={s.applyHead}>Your claims</p>
      <ul className={s.applyList}>
        {view.claims.map((c) => (
          <li key={c.id} className={s.claim}>
            <span>
              <b>{c.add.name}</b>
              {c.add.pos && ` · ${c.add.pos}`}
              {c.drop !== null && <> · drop {names.get(c.drop) ?? "a player"}</>}
              {c.processesAt && (
                <span className={s.fine}>
                  {" "}
                  · processes <LocalTime iso={c.processesAt} />
                </span>
              )}
            </span>
            {confirming === c.id ? (
              <span className={s.confirmActions}>
                <button type="button" className={s.primary} disabled={sending || (!agreed && !consenting)} onClick={() => cancel(c)}>
                  {sending ? "Cancelling…" : "Cancel claim on ESPN"}
                </button>
                <button type="button" className={s.textButton} disabled={sending} onClick={() => setConfirming(null)}>
                  Keep it
                </button>
              </span>
            ) : (
              <button
                type="button"
                className={s.textButton}
                onClick={() => {
                  setConfirming(c.id);
                  setFailed(null);
                }}
              >
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>
      {confirming && !agreed && <WriteConsent checked={consenting} onChange={setConsenting} />}
      {failed && (
        <p className={s.applyProblems} role="alert">
          {failed}
        </p>
      )}
    </div>
  );
}
