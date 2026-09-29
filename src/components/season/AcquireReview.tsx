"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { checkAcquire, needsDrop, rosterLimit } from "@/lib/season/acquire";
import { snapshotOf } from "@/lib/season/apply";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import type { Pickup } from "@/lib/season/waivers";
import s from "./season.module.css";
import { WriteConsent } from "./WriteConsent";

/**
 * Adding a player on ESPN from the Waivers tab: a free agent at once (13.3), or a claim on a player
 * still on waivers (13.4), in leagues that don't bid FAAB. The user picks who to drop (War
 * Room's suggestion first), reviews, and confirms. The server re-reads ESPN, writes the add and the
 * drop in one transaction, and reads ESPN back. Nothing here writes on its own.
 */

type Phase = { kind: "review" } | { kind: "sending" } | { kind: "failed"; error: string; details: string[] };

export function AcquireReview({
  view,
  leagueId,
  pickup,
  agreed: agreedAtLoad,
  onDone,
  onCancel,
}: {
  view: SeasonView;
  leagueId: string;
  pickup: Pickup;
  agreed: boolean;
  /** The add or claim went through; `message` says what ESPN shows now. */
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const limit = rosterLimit(view.starters, view.benchSize);
  const full = needsDrop(roster, limit);
  const droppable = roster.filter((p) => p.slot !== "IR" && !p.locked).sort((a, b) => a.ros - b.ros);
  const [drop, setDrop] = useState<number | null>(pickup.drop ?? (full ? (droppable[0]?.playerId ?? null) : null));
  const [phase, setPhase] = useState<Phase>({ kind: "review" });
  const [agreed, setAgreed] = useState(agreedAtLoad);
  const [consenting, setConsenting] = useState(false);
  const claim = pickup.player.status === "WAIVERS";
  const others = view.teams.filter((t) => t.id !== view.myTeamId);
  const problems = checkAcquire(roster, others, { add: pickup.player.playerId, drop }, limit);
  const name = (p: ViewPlayer) => `${p.name} · ${p.pos} · ${p.ros.toFixed(1)} rest of season`;

  async function send() {
    setPhase({ kind: "sending" });
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/acquire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: claim ? "claim" : "add",
        week: view.currentWeek,
        snapshot: snapshotOf(roster),
        add: pickup.player.playerId,
        drop,
        ...(agreed ? {} : { consentVersion: ESPN_WRITE_VERSION }),
      }),
    }).catch(() => null);
    if (!res)
      return setPhase({
        kind: "failed",
        error: "Can't reach War Room right now. Nothing was sent to ESPN.",
        details: [],
      });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      added?: boolean;
      dropped?: boolean;
      pending?: boolean;
      consent?: unknown;
      changed?: string[];
      problems?: string[];
      refused?: string[];
    };
    if (res.ok && typeof body.pending === "boolean") {
      router.refresh();
      return onDone(
        body.pending
          ? `Claim placed for ${pickup.player.name}${pickup.player.waiverClears ? `. Waivers process ${new Date(pickup.player.waiverClears).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}.`
          : `ESPN doesn't show your claim for ${pickup.player.name}. Check ESPN. War Room has been alerted.`,
      );
    }
    if (res.ok && typeof body.added === "boolean") {
      router.refresh();
      const dropped = drop === null ? "" : body.dropped ? `, and ${roster.find((p) => p.playerId === drop)?.name ?? "your drop"} is gone` : ", but your drop is still on your team";
      return onDone(body.added ? `Done. ${pickup.player.name} is on your team${dropped}.` : `ESPN doesn't show ${pickup.player.name} on your team. Check ESPN. War Room has been alerted.`);
    }
    if (body.consent) {
      setAgreed(false);
      setConsenting(false);
      return setPhase({ kind: "review" });
    }
    if (res.status === 409 || res.status === 502) setAgreed(true);
    setPhase({
      kind: "failed",
      error: body.error ?? "Something went wrong. Check your team on ESPN.",
      details: body.changed ?? body.problems ?? body.refused ?? [],
    });
  }

  const sending = phase.kind === "sending";
  return (
    <div className={`${s.confirm} ${s.pickupReview}`}>
      <p>
        {claim ? "Claim" : "Add"} <b>{pickup.player.name}</b> on ESPN{claim ? "" : ` for week ${view.currentWeek}`}
        {drop === null ? "." : claim ? ", dropping if the claim succeeds:" : ", dropping:"}
      </p>
      <select className={s.select} value={drop ?? ""} disabled={sending} onChange={(e) => setDrop(e.target.value === "" ? null : Number(e.target.value))} aria-label="Player to drop">
        {!full && <option value="">No one: you have room</option>}
        {droppable.map((p) => (
          <option key={p.playerId} value={p.playerId}>
            {name(p)}
            {p.playerId === pickup.drop ? " (suggested)" : ""}
          </option>
        ))}
      </select>
      {drop !== null && <p className={s.fine}>A dropped player goes on waivers, so getting them back takes a claim.</p>}
      {problems.length > 0 && (
        <ul className={s.applyProblems}>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {!agreed && <WriteConsent checked={consenting} onChange={setConsenting} />}
      <div className={s.confirmActions}>
        <button type="button" className={s.primary} onClick={send} disabled={sending || problems.length > 0 || (!agreed && !consenting)}>
          {sending ? (claim ? "Claiming…" : "Adding…") : claim ? "Claim on ESPN" : "Add on ESPN"}
        </button>
        <button type="button" className={s.textButton} onClick={onCancel} disabled={sending}>
          Cancel
        </button>
      </div>
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
    </div>
  );
}
