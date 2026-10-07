"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { irEligible, label, snapshotOf } from "@/lib/season/apply";
import type { LineupMove } from "@/lib/season/lineup";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { Check } from "./Icons";
import { signed } from "./parts";
import s from "./season.module.css";
import type { Landed, LineupDraft } from "./useLineupDraft";
import { WriteConsent } from "./WriteConsent";

/**
 * Applying the staged lineup to ESPN (12.1). The user stages it in the lineup rows (APE-249) and
 * ticks which of its changes to make (a swap is one change); here they review and confirm. The
 * server re-reads ESPN, writes the chosen moves in one transaction, and reads ESPN back to show which
 * landed. Moves left out stay staged for later. Nothing here ever writes on its own.
 */
export function ApplyLineup({
  draft,
  view,
  leagueId,
  agreed: agreedAtLoad,
  done = false,
  banked = 0,
}: {
  draft: LineupDraft;
  view: SeasonView;
  leagueId: string;
  agreed: boolean;
  /** ESPN has War Room's lineup (APE-294): the panel's title says so, and nothing here repeats it. */
  done?: boolean;
  /** What War Room's moves banked this week. */
  banked?: number;
}) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(agreedAtLoad);
  const [consenting, setConsenting] = useState(false);
  const { roster, byId, moves, changes, picked, chosen, problems, phase, setPhase, landed } = draft;
  const count = picked.length === 1 ? "1 change" : `${picked.length} changes`;
  const name = (id: number) => byId.get(id)?.name ?? `Player ${id}`;

  async function apply() {
    setPhase({ kind: "sending" });
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        week: view.currentWeek,
        season: view.season,
        snapshot: snapshotOf(roster),
        moves: chosen,
        suggested: draft.suggested,
        ...(agreed ? {} : { consentVersion: ESPN_WRITE_VERSION }),
      }),
    }).catch(() => null);
    if (!res) return setPhase({ kind: "failed", error: "Can't reach War Room right now. Nothing was sent to ESPN.", details: [] });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      moves?: Landed;
      consent?: unknown;
      changed?: string[];
      problems?: string[];
      refused?: string[];
      unverified?: boolean;
    };
    if (res.ok && body.moves) {
      setAgreed(true);
      draft.applied(body.moves);
      router.refresh();
      return;
    }
    if (body.consent) {
      setAgreed(false);
      setConsenting(false);
      return setPhase({ kind: "review" });
    }
    // Past the consent check (the server recorded it): the move checks, ESPN, or the re-read said no.
    if (res.status === 409 || res.status === 502) setAgreed(true);
    setPhase({ kind: "failed", error: body.error ?? "Something went wrong. Check your lineup on ESPN.", details: body.changed ?? body.problems ?? body.refused ?? [], unverified: body.unverified });
  }

  // A straight swap reads as one: "Start Jefferson at FLEX, bench Wilson". Anything else lists its moves.
  const changeLine = (group: readonly LineupMove[]) => {
    const into = group.find((m) => m.to !== "BN" && m.to !== "IR");
    const out = group.find((m) => m.to === "BN");
    if (group.length <= 2 && into && (!out || out.from === into.to)) {
      return (
        <>
          Start <b>{name(into.playerId)}</b> at {label(into.to)}
          {out && (
            <>
              , bench <b>{name(out.playerId)}</b>
            </>
          )}
        </>
      );
    }
    return group.map((m, i) => (
      <span key={m.playerId}>
        {i > 0 && "; "}
        {moveLine(m)}
      </span>
    ));
  };

  const moveLine = (m: LineupMove) => (
    <>
      <b>{name(m.playerId)}</b>: {label(m.from)} → {label(m.to)}
    </>
  );

  return (
    <div className={s.apply}>
      {landed && !(done && landed.every((m) => m.landed)) && <Results moves={landed} line={moveLine} />}

      {moves.length === 0 ? (
        <>
          {done && banked >= 0.05 && (
            <p className={s.applyBanked}>
              Every War Room move is in, worth <b className="tabular-nums">{signed(banked)}</b> projected this week.
            </p>
          )}
          <p className={s.fine}>{done ? "" : "ESPN already has this lineup. "}Tap a slot to change anything, starters or bench.</p>
        </>
      ) : (
        <>
          {picked.length > 0 && (
            <ul className={`${s.applyList} ${s.applyChanges}`}>
              {picked.map((g) => (
                <li key={g.map((m) => m.playerId).join("-")}>{changeLine(g)}</li>
              ))}
            </ul>
          )}
          {picked.length === 0 ? (
            <p className={s.fine}>{changes.length === 1 ? "The change is left out." : `All ${changes.length} changes are left out.`}</p>
          ) : (
            <p className={s.fine}>
              {changes.length > picked.length ? (
                <>
                  {changes.length - picked.length} left out.{" "}
                  <button type="button" className={s.textButton} onClick={draft.restore} disabled={phase.kind === "sending"}>
                    Restore all
                  </button>
                </>
              ) : changes.length > 1 ? (
                "Untick a row's Swap box to leave that change out."
              ) : (
                "Untick Swap on the row to leave it out."
              )}
            </p>
          )}
          {problems.length > 0 && (
            <ul className={s.applyProblems}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          {phase.kind === "review" || phase.kind === "sending" ? (
            <div className={s.confirm}>
              <p>
                Apply {picked.length === 1 ? "this change" : `these ${picked.length} changes`} to your team on ESPN for week {view.currentWeek}?
              </p>
              {!agreed && <WriteConsent checked={consenting} onChange={setConsenting} />}
              <div className={s.confirmActions}>
                <button type="button" className={s.primary} onClick={apply} disabled={phase.kind === "sending" || (!agreed && !consenting)}>
                  {phase.kind === "sending" ? "Setting your lineup…" : "Apply to ESPN"}
                </button>
                <button type="button" className={s.textButton} onClick={() => setPhase({ kind: "idle" })} disabled={phase.kind === "sending"}>
                  Cancel
                </button>
              </div>
            </div>
          ) : picked.length === 0 ? (
            // Everything left out: the one useful next step is getting War Room's picks back.
            <button type="button" className={s.primary} onClick={draft.restore}>
              Restore War Room&apos;s picks
            </button>
          ) : (
            <button type="button" className={s.primary} disabled={chosen.length === 0 || problems.length > 0} onClick={() => setPhase({ kind: "review" })}>
              Review {count}
            </button>
          )}
        </>
      )}

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
          {!phase.unverified && (
            <a className={s.link} href={`/season/${leagueId}?refresh=1`}>
              Reload from ESPN
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the last apply did. Once everything landed, the rows say it: the moves War Room got the user
 * are marked there (APE-256). Only a move that didn't land is listed, move by move, from ESPN's read.
 */
function Results({ moves, line }: { moves: Landed; line: (m: LineupMove) => React.ReactNode }) {
  const missed = moves.filter((m) => !m.landed);
  if (!missed.length) {
    return (
      <p className={`${s.applyHead} ${s.applyDone}`} role="status">
        <Check /> Done. ESPN has your new lineup.
      </p>
    );
  }
  return (
    <div className={s.applyResult} role="status">
      <p className={s.applyHead}>Some moves didn&apos;t land on ESPN</p>
      <ul className={s.applyList}>
        {moves.map((m) => (
          <li key={m.playerId} data-landed={m.landed}>
            {m.landed ? <Check /> : <span aria-hidden>✕</span>} {line(m)}
            {!m.landed && <span className="sr-only"> (didn&apos;t land)</span>}
          </li>
        ))}
      </ul>
      <p className={s.aiError}>Check these on ESPN. War Room has been alerted.</p>
    </div>
  );
}

/** Who's on IR, and who could go there: players ESPN lists as out or on injured reserve (13.2). */
export function IrPicker({ roster, ir, irSlots, onToggle }: { roster: readonly ViewPlayer[]; ir: readonly number[]; irSlots: number; onToggle: (id: number, on: boolean) => void }) {
  const candidates = roster.filter((p) => p.slot === "IR" || (irEligible(p) && !p.locked));
  // A healthy team has nothing to move, so the bench doesn't carry an empty IR section (APE-295).
  if (!candidates.length) return null;
  return (
    <fieldset className={s.irPicker}>
      <legend className={s.seatKey}>
        IR · {ir.length} of {irSlots}
      </legend>
      {candidates.map((p) => (
        <label key={p.playerId} className={s.check}>
          <input type="checkbox" checked={ir.includes(p.playerId)} disabled={p.locked} onChange={(e) => onToggle(p.playerId, e.target.checked)} />
          {p.name} <span className={s.fine}>· {p.injuryStatus === "INJURY_RESERVE" ? "injured reserve" : p.injuryStatus.toLowerCase()}</span>
        </label>
      ))}
    </fieldset>
  );
}
