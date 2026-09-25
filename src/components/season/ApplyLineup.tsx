"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ESPN_LINEUP_WRITE_DISCLOSURE, ESPN_LINEUP_WRITE_VERSION } from "@/lib/espn/disclosure";
import { canPlay, checkMoves, label, movesToStaged, snapshotOf, starterSeats } from "@/lib/season/apply";
import type { LineupMove } from "@/lib/season/lineup";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { Check } from "./Icons";
import s from "./season.module.css";

/**
 * Setting the lineup on ESPN from War Room (12.1). The user stages a lineup (War Room's, or edited
 * by hand), reviews every move, and confirms; the server re-reads ESPN, writes the moves in one
 * transaction, and reads ESPN back to show which landed. Nothing here ever writes on its own.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "review" }
  | { kind: "sending" }
  | { kind: "done"; moves: (LineupMove & { landed: boolean })[] }
  | { kind: "failed"; error: string; details: string[]; unverified?: boolean };

const SLOT_NAME: Record<string, string> = { SUPERFLEX: "OP", DST: "D/ST" };
const seatName = (key: string) => SLOT_NAME[key] ?? key;

export function ApplyLineup({ view, leagueId, agreed: agreedAtLoad }: { view: SeasonView; leagueId: string; agreed: boolean }) {
  const router = useRouter();
  const roster = useMemo(() => view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [], [view]);
  const byId = useMemo(() => new Map(roster.map((p) => [p.playerId, p])), [roster]);
  const seats = useMemo(() => starterSeats(view.starters), [view.starters]);
  const recommended = useMemo(() => view.lineup.starters.map((f) => f.playerId), [view.lineup]);
  const [staged, setStaged] = useState<(number | null)[]>(recommended);
  const [editing, setEditing] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [agreed, setAgreed] = useState(agreedAtLoad);
  const [consenting, setConsenting] = useState(false);

  const moves = movesToStaged(roster, seats, staged);
  const problems = moves.length ? checkMoves(roster, moves, view.starters, view.benchSize) : [];
  const edited = staged.some((id, i) => id !== recommended[i]);
  const name = (id: number) => byId.get(id)?.name ?? `Player ${id}`;

  function choose(seat: number, id: number | null) {
    setStaged((prev) => {
      const next = [...prev];
      const was = next.indexOf(id);
      // Picking someone already staged elsewhere swaps the two, when the other seat can take them.
      if (id !== null && was >= 0 && was !== seat) {
        const displaced = next[seat];
        const p = displaced === null ? undefined : byId.get(displaced);
        next[was] = p && canPlay(p.pos, seats[was]) ? displaced : null;
      }
      next[seat] = id;
      return next;
    });
    setPhase({ kind: "idle" });
  }

  async function apply() {
    setPhase({ kind: "sending" });
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ week: view.currentWeek, snapshot: snapshotOf(roster), moves, ...(agreed ? {} : { consentVersion: ESPN_LINEUP_WRITE_VERSION }) }),
    }).catch(() => null);
    if (!res) return setPhase({ kind: "failed", error: "Can't reach War Room right now. Nothing was sent to ESPN.", details: [] });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      moves?: (LineupMove & { landed: boolean })[];
      consent?: unknown;
      changed?: string[];
      problems?: string[];
      refused?: string[];
      unverified?: boolean;
    };
    if (res.ok && body.moves) {
      setAgreed(true);
      setPhase({ kind: "done", moves: body.moves });
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

  const moveLine = (m: LineupMove) => (
    <>
      <b>{name(m.playerId)}</b>: {label(m.from)} → {label(m.to)}
    </>
  );

  if (phase.kind === "done") {
    const missed = phase.moves.filter((m) => !m.landed);
    return (
      <div className={s.apply} role="status">
        <p className={s.applyHead}>{missed.length ? "Some moves didn't land on ESPN" : "Done. ESPN has your new lineup."}</p>
        <ul className={s.applyList}>
          {phase.moves.map((m) => (
            <li key={m.playerId} data-landed={m.landed}>
              {m.landed ? <Check /> : <span aria-hidden>✕</span>} {moveLine(m)}
              {!m.landed && <span className="sr-only"> (didn&apos;t land)</span>}
            </li>
          ))}
        </ul>
        {missed.length > 0 && <p className={s.aiError}>Check these on ESPN. War Room has been alerted.</p>}
      </div>
    );
  }

  return (
    <div className={s.apply}>
      <div className={s.applyTop}>
        <p className={s.applyHead}>Set it on ESPN from here</p>
        <button type="button" className={s.textButton} onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          {editing ? "Done editing" : "Edit lineup"}
        </button>
      </div>

      {editing && (
        <div className={s.seats}>
          {seats.map((key, i) => {
            const current = staged[i];
            const lockedHere = current !== null && byId.get(current)?.locked;
            const options = roster.filter((p) => p.slot !== "IR" && canPlay(p.pos, key) && (!p.locked || p.playerId === current));
            return (
              <label key={`${key}-${i}`} className={s.seat}>
                <span className={s.seatKey}>{seatName(key)}</span>
                <select className={s.select} value={current ?? ""} disabled={!!lockedHere} onChange={(e) => choose(i, e.target.value === "" ? null : Number(e.target.value))}>
                  <option value="">Empty</option>
                  {options.map((p: ViewPlayer) => (
                    <option key={p.playerId} value={p.playerId}>
                      {p.name} · {p.points.toFixed(1)}
                      {p.locked ? " · locked" : ""}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {edited && (
            <button type="button" className={s.textButton} onClick={() => setStaged(recommended)}>
              Back to War Room&apos;s lineup
            </button>
          )}
        </div>
      )}

      {moves.length === 0 ? (
        <p className={s.fine}>{edited ? "This lineup is what ESPN already has." : "Nothing to send: ESPN already has this lineup."}</p>
      ) : (
        <>
          <p className={s.fine}>
            {moves.length === 1 ? "1 move" : `${moves.length} moves`}
            {edited ? ", from your edits" : ", from War Room's lineup"}:
          </p>
          <ul className={s.applyList}>
            {moves.map((m) => (
              <li key={m.playerId}>{moveLine(m)}</li>
            ))}
          </ul>
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
                Apply {moves.length === 1 ? "this move" : `these ${moves.length} moves`} to your team on ESPN for week {view.currentWeek}?
              </p>
              {!agreed && (
                <div className={s.consent}>
                  <ul>
                    {ESPN_LINEUP_WRITE_DISCLOSURE.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <label className={s.check}>
                    <input type="checkbox" checked={consenting} onChange={(e) => setConsenting(e.target.checked)} /> I agree
                  </label>
                </div>
              )}
              <div className={s.confirmActions}>
                <button type="button" className={s.primary} onClick={apply} disabled={phase.kind === "sending" || (!agreed && !consenting)}>
                  {phase.kind === "sending" ? "Setting your lineup…" : "Apply to ESPN"}
                </button>
                <button type="button" className={s.textButton} onClick={() => setPhase({ kind: "idle" })} disabled={phase.kind === "sending"}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={s.primary} disabled={problems.length > 0} onClick={() => setPhase({ kind: "review" })}>
              Review {moves.length === 1 ? "1 move" : `${moves.length} moves`}
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
