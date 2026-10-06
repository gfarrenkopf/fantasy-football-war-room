"use client";

import { useMemo, useState } from "react";
import { alignSeats, checkMoves, chooseSeat, groupMoves, movesToStaged, seatsFromRoster, starterSeats, type SuggestedMove } from "@/lib/season/apply";
import type { LineupMove } from "@/lib/season/lineup";
import { lockIn, type LockIn, type OwnMove } from "@/lib/season/lockIn";
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
  /** The lineup just locked in with War Room's moves (APE-294), and ESPN's roster as it was sent. */
  const [moment, setMoment] = useState<(LockIn & { sentFrom: string }) | null>(null);
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
  // A chosen move is War Room's when it puts the player in the very seat War Room recommended him
  // for (APE-256). Its gain is that seat's: his projection over the player ESPN has there.
  const points = (id: number | null) => (id === null ? 0 : (byId.get(id)?.points ?? 0));
  const suggested: SuggestedMove[] = chosen.flatMap((m) => {
    const seat = staged.indexOf(m.playerId);
    return seat >= 0 && recommended[seat] === m.playerId && seats[seat] === m.to ? [{ playerId: m.playerId, to: m.to, gain: Math.round((points(m.playerId) - points(onEspn[seat])) * 100) / 100 }] : [];
  });

  /** Any edit starts over: the review closes and the last apply's results, and their moment, go. */
  const edited = () => {
    setPhase({ kind: "idle" });
    setLanded(null);
    setMoment(null);
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
    suggested,
    problems,
    changeOf,
    phase,
    setPhase,
    landed,
    moment,
    /** ESPN's lineup has been read back since the moment: what's left of War Room's lineup is current. */
    momentSettled: moment !== null && rosterKey(roster) !== moment.sentFrom,
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
    /** Back to War Room's lineup with every change ticked: the way out after leaving everything out. */
    restore() {
      setStagedRaw(recommended);
      setIr(onIr);
      setSkipped(new Set());
      edited();
    },
    startFrom(lineup: readonly (number | null)[]) {
      setStagedRaw([...lineup]);
      setIr(onIr);
      edited();
    },
    /** ESPN took the apply: show what landed, and keep what was left out on offer. */
    applied(result: Landed) {
      setLanded(result);
      // The starting seats this apply changed, and what each does to the projection.
      const seatMoves = seats.flatMap((to, i) => {
        const group = changeOf.get(staged[i] ?? onEspn[i] ?? -1);
        return staged[i] !== onEspn[i] && (!group || picked.includes(group)) ? [{ i, to, delta: points(staged[i]) - points(onEspn[i]) }] : [];
      });
      // The ones the user made themselves.
      const own: OwnMove[] = seatMoves.flatMap(({ i, to, delta }) => {
        const id = staged[i];
        return id !== null && !suggested.some((m) => m.playerId === id && m.to === to) ? [{ playerId: id, to, delta: Math.round(delta * 100) / 100 }] : [];
      });
      const total = (lineup: readonly (number | null)[]) => lineup.reduce((sum: number, id) => sum + points(id), 0);
      const before = total(onEspn);
      const after = before + seatMoves.reduce((sum, m) => sum + m.delta, 0);
      const found = lockIn({ landed: result, suggested, own, before, after, recommended: total(recommended) });
      setMoment(found && { ...found, sentFrom: rosterKey(roster) });
      setKeepStaged(chosen.length < moves.length);
      setPhase({ kind: "idle" });
    },
  };
}

export type LineupDraft = ReturnType<typeof useLineupDraft>;
