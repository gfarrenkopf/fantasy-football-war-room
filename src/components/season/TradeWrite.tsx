"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import s from "./season.module.css";
import { WriteConsent } from "./WriteConsent";

/**
 * The confirm step for a trade on ESPN (13.5): proposing the builder's trade, or accepting,
 * declining or withdrawing an offer. It says what will happen, asks for consent the first time,
 * and sends `body` to the trades route, which re-reads ESPN before and after. Nothing here writes
 * until the user confirms.
 */
export function TradeWrite({
  leagueId,
  agreed: agreedAtLoad,
  body,
  question,
  confirm,
  sending: sendingLabel,
  onDone,
  onCancel,
}: {
  leagueId: string;
  agreed: boolean;
  body: Record<string, unknown>;
  question: React.ReactNode;
  confirm: string;
  sending: string;
  /** ESPN took it; `landed` is whether the re-read shows it. */
  onDone: (landed: boolean) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(agreedAtLoad);
  const [consenting, setConsenting] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<{ error: string; details: string[] } | null>(null);

  async function send() {
    setSending(true);
    setFailed(null);
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/trades`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, ...(agreed ? {} : { consentVersion: ESPN_WRITE_VERSION }) }),
    }).catch(() => null);
    const answer = (await res?.json().catch(() => ({}))) as { error?: string; pending?: boolean; done?: boolean; consent?: unknown; changed?: string[]; problems?: string[]; refused?: string[] } | undefined;
    setSending(false);
    if (res?.ok && (typeof answer?.pending === "boolean" || typeof answer?.done === "boolean")) {
      router.refresh();
      return onDone(!!(answer.pending ?? answer.done));
    }
    if (answer?.consent) {
      setAgreed(false);
      return setConsenting(false);
    }
    if (res && (res.status === 409 || res.status === 502)) setAgreed(true);
    setFailed({ error: answer?.error ?? "Can't reach Draft Room right now. Nothing was sent to ESPN.", details: answer?.changed ?? answer?.problems ?? answer?.refused ?? [] });
  }

  return (
    <div className={s.confirm}>
      <p>{question}</p>
      {!agreed && <WriteConsent checked={consenting} onChange={setConsenting} />}
      <div className={s.confirmActions}>
        <button type="button" className={s.primary} onClick={send} disabled={sending || (!agreed && !consenting)}>
          {sending ? sendingLabel : confirm}
        </button>
        <button type="button" className={s.textButton} onClick={onCancel} disabled={sending}>
          Cancel
        </button>
      </div>
      {failed && (
        <div className={s.applyProblems} role="alert">
          <p>{failed.error}</p>
          {failed.details.length > 0 && (
            <ul>
              {failed.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
