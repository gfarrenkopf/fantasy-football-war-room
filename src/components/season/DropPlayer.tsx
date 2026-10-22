"use client";

import { useEffect, useRef, useState } from "react";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { snapshotOf } from "@/lib/season/apply";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import s from "./season.module.css";
import { WriteConsent } from "./WriteConsent";

/**
 * Dropping a player from the lineup with nobody added (APE-425). The pickers offer it last, in red,
 * and it always asks again in a dialog before anything goes to ESPN: a dropped player goes on waivers,
 * so getting him back takes a claim. The server re-reads the roster before and after, as every write does.
 */

/** The picker's last option: red, so it never reads as one more place to put him. */
export function DropOption({ player, onDrop }: { player: ViewPlayer; onDrop: () => void }) {
  return (
    <li>
      <button type="button" className={`${s.pickerOption} ${s.pickerDrop}`} onClick={onDrop}>
        Drop {player.name}
      </button>
    </li>
  );
}

type Phase = { kind: "confirm" } | { kind: "sending" } | { kind: "failed"; error: string; details: string[] };

export function DropDialog({
  view,
  leagueId,
  player,
  agreed: agreedAtOpen,
  onAgreed,
  onDropped,
  onClose,
}: {
  view: SeasonView;
  leagueId: string;
  player: ViewPlayer;
  agreed: boolean;
  /** The user agreed to ESPN writes with this drop, so later writes don't ask again. */
  onAgreed: () => void;
  /** ESPN took the drop; `message` says what the re-read shows. */
  onDropped: (message: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  const [agreed, setAgreed] = useState(agreedAtOpen);
  const [consenting, setConsenting] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function drop() {
    setPhase({ kind: "sending" });
    const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/acquire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "drop",
        week: view.currentWeek,
        snapshot: snapshotOf(roster),
        drop: player.playerId,
        ...(agreed ? {} : { consentVersion: ESPN_WRITE_VERSION }),
      }),
    }).catch(() => null);
    if (!res) return setPhase({ kind: "failed", error: "Can't reach Draft Room right now. Nothing was sent to ESPN.", details: [] });
    const body = (await res.json().catch(() => ({}))) as { error?: string; dropped?: boolean; consent?: unknown; changed?: string[]; problems?: string[]; refused?: string[] };
    if (res.ok && typeof body.dropped === "boolean") {
      if (!agreed) onAgreed();
      return onDropped(body.dropped ? `${player.name} is off your team.` : `ESPN still shows ${player.name} on your team. Check ESPN. Draft Room has been alerted.`);
    }
    if (body.consent) {
      setAgreed(false);
      setConsenting(false);
      return setPhase({ kind: "confirm" });
    }
    if (res.status === 409 || res.status === 502) setAgreed(true);
    setPhase({ kind: "failed", error: body.error ?? "Something went wrong. Check your team on ESPN.", details: body.changed ?? body.problems ?? body.refused ?? [] });
  }

  const sending = phase.kind === "sending";
  return (
    <dialog
      ref={ref}
      className={s.dropDialog}
      aria-labelledby="drop-title"
      onClose={onClose}
      onCancel={(e) => sending && e.preventDefault()}
      onClick={(e) => !sending && e.target === e.currentTarget && ref.current?.close()}
    >
      <div className={s.dropBody}>
        <h2 id="drop-title" className={s.dropTitle}>
          Drop {player.name}?
        </h2>
        <p className={s.dropText}>
          {player.name} goes on waivers, and anyone in the league can claim them. Getting them back takes a claim of your own.
        </p>
        {!agreed && <WriteConsent checked={consenting} onChange={setConsenting} />}
        {phase.kind === "failed" && (
          <div className={s.applyProblems} role="alert">
            <p>{phase.error}</p>
            {phase.details.length > 0 && (
              <ul>
                {phase.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className={s.confirmActions}>
          <button type="button" className={s.dangerButton} disabled={sending || (!agreed && !consenting)} onClick={drop}>
            {sending ? "Dropping…" : "Drop on ESPN"}
          </button>
          <button type="button" className={s.textButton} disabled={sending} onClick={() => ref.current?.close()} autoFocus>
            Keep them
          </button>
        </div>
      </div>
    </dialog>
  );
}
