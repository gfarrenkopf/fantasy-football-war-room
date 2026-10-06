"use client";

import { useMemo, useState } from "react";
import { alignSeats, checkMoves, chooseSeat, groupMoves, movesToStaged, seatsFromRoster, starterSeats } from "@/lib/season/apply";
import type { LineupMove } from "@/lib/season/lineup";
import type { SeasonView } from "@/lib/season/view";

/**
 * The lineup the user is staging for ESPN (12.1, APE-249), shared by the rows that edit it and the
 * panel that applies it. It starts as War Room's lineup; once ESPN's lineup changes under it (after an
 * apply, or a refresh), it starts again from what ESPN has, so moves already made don't show as still
 * to make. Each change is made or left out whole, and starts ticked. Nothing here writes to ESPN.
 */

export type Phase =
  | { kind: "idle" }
  | { kind: "review" }
  | { kind: "sending" }
  | { kind: "failed"; error: string; details: string[]; unverified?: boolean };

export type Landed = (LineupMove & { landed: boolean })[];

/** Where each of the user's players sits on ESPN: changes whenever a fresh read does. */
const rosterKey = (roster: readonly { playerId: number; slot: string }[]) => roster.map((p) => `${p.playerId}:${p.slot}`).join(",");

/** A change by what its moves do, so one the user left out stays left out until the staged lineup changes it. */
export const changeKey = (group: readonly LineupMove[]) => group.map((m) => `${m.playerId}:${m.to}`).join(",");

export function useLineupDraft(view: SeasonView) {
  const roster = useMemo(() => view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [], [view]);
  const byId = useMemo(() => new Map(roster.map((p) => [p.playerId, p])), [roster]);
  const seats = useMemo(() => starterSeats(view.starters), [view.starters]);
  const onEspn = useMemo(() => seatsFromRoster(roster, seats), [roster, seats]);
  const recommended = useMemo(() => alignSeats(seats, onEspn, view.lineup.starters.map((f) => f.playerId)), [seats, onEspn, view.lineup]);
  const onIr = useMemo(() => roster.filter((p) => p.slot === "IR").map((p) => p.playerId), [roster]);

  const [staged, setStagedRaw] = useState<(number | null)[]>(recommended);
  /** Who should be on IR (13.2). */
  const [ir, setIr] = useState<number[]>(onIr);
  const [seenRoster, setSeenRoster] = useState(() => rosterKey(roster));
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [landed, setLanded] = useState<Landed | null>(null);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  // After an apply that left moves out, keep the staged lineup so those moves are still on offer.
  const [keepStaged, setKeepStaged] = useState(false);
  if (rosterKey(roster) !== seenRoster) {
    setSeenRoster(rosterKey(roster));
    if (!keepStaged) {
      setStagedRaw(onEspn);
      setIr(onIr);
    }
    setKeepStaged(false);
  }

  const moves = movesToStaged(roster, seats, staged, ir);
  const changes = groupMoves(moves, onEspn, staged);
  const picked = changes.filter((g) => !skipped.has(changeKey(g)));
  const chosen = picked.flat();
  const problems = chosen.length ? checkMoves(roster, chosen, view.starters, view.benchSize, view.irSlots) : [];
  /** The change each moving player belongs to. */
  const changeOf = new Map(changes.flatMap((g) => g.map((m) => [m.playerId, g] as const)));
  const same = (a: readonly (number | null)[]) => staged.every((id, i) => id === a[i]);

  /** Any edit starts over: the review closes and the last apply's results go. */
  const edited = () => {
    setPhase({ kind: "idle" });
    setLanded(null);
  };

  return {
    roster,
    byId,
    seats,
    onEspn,
    recommended,
    staged,
    ir,
    moves,
    changes,
    picked,
    chosen,
    problems,
    changeOf,
    phase,
    setPhase,
    landed,
    /** Where the staged lineup came from, in words. */
    source: same(recommended) ? "War Room's lineup" : "your edits",
    isOnEspn: same(onEspn),
    isRecommended: same(recommended),
    isPicked: (group: readonly LineupMove[]) => !skipped.has(changeKey(group)),

    choose(seat: number, id: number | null) {
      setStagedRaw((prev) => alignSeats(seats, onEspn, chooseSeat(prev, seats, roster, seat, id)));
      edited();
    },
    toggleIr(id: number, on: boolean) {
      setIr((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
      // A player going on IR gives up their seat.
      if (on) setStagedRaw((prev) => prev.map((x) => (x === id ? null : x)));
      edited();
    },
    toggle(group: readonly LineupMove[], on: boolean) {
      setSkipped((prev) => {
        const next = new Set(prev);
        if (on) next.delete(changeKey(group));
        else next.add(changeKey(group));
        return next;
      });
      setPhase({ kind: "idle" });
    },
    startFrom(lineup: readonly (number | null)[]) {
      setStagedRaw([...lineup]);
      setIr(onIr);
      edited();
    },
    /** ESPN took the apply: show what landed, and keep what was left out on offer. */
    applied(result: Landed) {
      setLanded(result);
      setKeepStaged(chosen.length < moves.length);
      setPhase({ kind: "idle" });
    },
  };
}

export type LineupDraft = ReturnType<typeof useLineupDraft>;
