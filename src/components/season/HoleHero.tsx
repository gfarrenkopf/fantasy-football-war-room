"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { label } from "@/lib/season/apply";
import { fillPlan } from "@/lib/season/holeFill";
import { FILL_OPTIONS, holeSlots, type Fill, type Hole, type HoleFills } from "@/lib/season/holes";
import type { LineupMove } from "@/lib/season/lineup";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { ArrowRight, Warning } from "./Icons";
import { LocalTime } from "./LocalTime";
import { INJURY_TAG, PlayerLine, pts, signed } from "./parts";
import s from "./season.module.css";
import { WriteConsent } from "./WriteConsent";

/**
 * A hole in this week's lineup (APE-350): a starting slot nobody on the roster can play, because its
 * only player is out or on a bye. The hero says so instead of "Your lineup is set", with a warning
 * where the ✓ was, and offers the free agent who'd score most there, added and started in one tap.
 * Bench swaps War Room suggests besides stay listed under the holes.
 */

type Load = { kind: "loading" } | { kind: "ok"; fills: HoleFills[] } | { kind: "failed" };

/** A bench swap War Room suggests, as LineupPanel words it. */
export interface HeroSwap {
  key: string;
  slot: string;
  into?: ViewPlayer;
  out?: ViewPlayer;
  gain: number;
}

export function HoleHero({
  view,
  leagueId,
  holes,
  swaps,
  agreed,
  onWaivers,
  className,
}: {
  view: SeasonView;
  leagueId: string;
  /** The hard holes, in lineup order. */
  holes: readonly Hole[];
  swaps: readonly HeroSwap[];
  agreed: boolean;
  onWaivers: () => void;
  className?: string;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  // The holes as the server reads them: a refetch when they change, not on every render.
  const signature = holes.map((h) => `${h.key}:${h.playerId}`).join(",");

  useEffect(() => {
    let live = true;
    void fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/fills${attempt ? "?refresh=1" : ""}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ fills: HoleFills[] }>) : null))
      .catch(() => null)
      .then((body) => live && setLoad(body ? { kind: "ok", fills: body.fills } : { kind: "failed" }));
    return () => {
      live = false;
    };
  }, [leagueId, signature, attempt]);

  const fillsFor = (hole: Hole) => (load.kind === "ok" ? load.fills.find((f) => f.hole.key === hole.key && f.hole.playerId === hole.playerId) : undefined);

  return (
    <div className={`${s.gain} ${s.hole} ${className ?? ""}`} data-level="hole" role="status">
      <div className={s.gainLead}>
        <p className={s.gainNumber}>
          <span className="tabular-nums">{pts(view.lineup.total)}</span>
          <span className={s.gainUnit}>pts</span>
        </p>
        <p className={s.gainShift}>
          <span className={s.gainShiftNote}>
            projected · week {view.currentWeek}
            <br />
            {holes.length === 1 ? `0 from ${label(holes[0].key)}` : "0 from each hole"}
          </span>
        </p>
      </div>
      <p className={`${s.gainHeadline} ${s.lockHead}`}>
        <span className={s.holeStamp}>
          <Warning />
        </span>
        {holes.length === 1 ? "Hole at " : "Holes at "}
        {holeSlots(holes)}
      </p>
      <div className={s.gainDetail}>
        <ul className={s.holeList}>
          {holes.map((hole) => (
            <HoleRow
              key={`${hole.key}-${hole.playerId}`}
              view={view}
              leagueId={leagueId}
              hole={hole}
              holder={hole.playerId === null ? undefined : byId.get(hole.playerId)}
              fills={fillsFor(hole)}
              load={load.kind}
              agreed={agreed}
              onRetry={() => {
                setLoad({ kind: "loading" });
                setAttempt((n) => n + 1);
              }}
              onWaivers={onWaivers}
            />
          ))}
        </ul>
        {swaps.length > 0 && (
          <ul className={s.gainMoves}>
            {swaps.map((m) => (
              <li key={m.key}>
                <span className={s.gainMoveText}>
                  {m.into ? (
                    <>
                      Start <b>{m.into.name}</b>
                    </>
                  ) : (
                    <>Leave {m.slot} empty</>
                  )}
                  {m.out && <> over {m.out.name}</>}
                </span>
                <b className={`${s.gainMoveGain} tabular-nums`}>{signed(m.gain)}</b>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Why the slot is a hole, in a line: "Lamar Jackson OUT · no other QB on your team". */
function Why({ hole, holder }: { hole: Hole; holder: ViewPlayer | undefined }) {
  const slot = label(hole.key);
  if (!holder) return <>Nobody on your team can play {slot}.</>;
  return (
    <>
      <b>{holder.name}</b>{" "}
      {hole.reason === "bye" ? (
        <>is on a bye</>
      ) : (
        <span className={s.tag} data-kind="out">
          {INJURY_TAG[holder.injuryStatus] ?? "OUT"}
        </span>
      )}{" "}
      · no one else on your team can play {slot}
    </>
  );
}

function HoleRow({
  view,
  leagueId,
  hole,
  holder,
  fills,
  load,
  agreed,
  onRetry,
  onWaivers,
}: {
  view: SeasonView;
  leagueId: string;
  hole: Hole;
  holder: ViewPlayer | undefined;
  fills: HoleFills | undefined;
  load: Load["kind"];
  agreed: boolean;
  onRetry: () => void;
  onWaivers: () => void;
}) {
  const [more, setMore] = useState(false);
  const slot = label(hole.key);
  const options = fills?.fills ?? [];
  const claim = fills?.claims[0];
  return (
    <li className={s.holeRow}>
      <p className={s.holeWhy}>
        <Why hole={hole} holder={holder} />
      </p>
      {load === "loading" && (
        <p className={`${s.fine} ${s.holeWait}`} role="status">
          Looking for a {slot} on the wire…
        </p>
      )}
      {load === "failed" && (
        <p className={`${s.fine} ${s.holeWait}`}>
          The waiver wire couldn&apos;t be read.{" "}
          <button type="button" className={s.textButton} onClick={onRetry}>
            Try again
          </button>
        </p>
      )}
      {load === "ok" && !options.length && !claim && (
        <p className={s.holeNone}>
          No one left to add at {slot} this week. It scores <b className="tabular-nums">0</b>.
        </p>
      )}
      {options.length > 0 && (
        <ol className={s.fillList}>
          {(more ? options : options.slice(0, 1)).map((f, i) => (
            <FillOption key={f.player.playerId} view={view} leagueId={leagueId} hole={hole} fill={f} agreed={agreed} lead={i === 0} />
          ))}
        </ol>
      )}
      {(options.length > 1 || claim) && (
        <p className={s.holeMore}>
          {options.length > 1 && (
            <button type="button" className={s.textButton} aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {more ? "Fewer options" : `${Math.min(options.length, FILL_OPTIONS) - 1} more ${options.length === 2 ? "option" : "options"}`}
            </button>
          )}
          {claim && (
            <button type="button" className={s.textButton} onClick={onWaivers}>
              {options.length ? "Or claim" : "Claim"} {claim.player.name}
              {claim.player.waiverClears && (
                <>
                  {" "}
                  (clears <LocalTime iso={claim.player.waiverClears} />)
                </>
              )}{" "}
              <ArrowRight className={s.holeArrow} />
            </button>
          )}
        </p>
      )}
    </li>
  );
}

type Phase =
  | { kind: "idle" }
  /** Asking for the consent to write to ESPN, the first time. */
  | { kind: "consent" }
  | { kind: "sending"; step: string }
  | { kind: "done"; message: string }
  /** `retry` is the step to try again from, when an earlier one landed. */
  | { kind: "failed"; error: string; details: string[]; retry: "start" | null };

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json = (await res?.json().catch(() => ({}))) as {
    error?: string;
    added?: boolean;
    dropped?: boolean;
    moves?: (LineupMove & { landed: boolean })[];
    consent?: unknown;
    changed?: string[];
    problems?: string[];
    refused?: string[];
  } | null;
  return { ok: !!res?.ok, status: res?.status ?? 0, body: json ?? {} };
}

/**
 * One free agent who could fill the hole, and the button that does it: the hole's player to IR when
 * that makes room, the add (with its drop), then the start, as fillPlan() lays them out. Each write
 * is checked against the roster the one before it left, and a step that fails says what already happened.
 */
function FillOption({
  view,
  leagueId,
  hole,
  fill,
  agreed: agreedAtLoad,
  lead,
}: {
  view: SeasonView;
  leagueId: string;
  hole: Hole;
  fill: Fill;
  agreed: boolean;
  /** The best fill: its button is the hero's primary. The others are quieter. */
  lead: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [agreed, setAgreed] = useState(agreedAtLoad);
  const [consenting, setConsenting] = useState(false);
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const name = (id: number | null) => roster.find((p) => p.playerId === id)?.name ?? "your drop";
  const { player } = fill;
  const slot = label(hole.key);
  const base = `/api/leagues/${encodeURIComponent(leagueId)}/season`;

  const fail = (body: { error?: string; changed?: string[]; problems?: string[]; refused?: string[] }, fallback: string, retry: "start" | null = null) =>
    setPhase({ kind: "failed", error: body.error ?? fallback, details: body.changed ?? body.problems ?? body.refused ?? [], retry });

  const plan = fillPlan(view, hole, fill);

  /** Starts the new player in the hole's slot, benching whoever ESPN has there. */
  async function start(consent: object) {
    if (!plan) return;
    setPhase({ kind: "sending", step: `Starting ${player.name}…` });
    const r = await post(`${base}/apply`, { week: view.currentWeek, season: view.season, snapshot: plan.start.snapshot, moves: plan.start.moves, suggested: plan.start.suggested, ...consent });
    if (r.ok && r.body.moves?.every((m) => m.landed)) {
      router.refresh();
      return setPhase({ kind: "done", message: `Done. ${player.name} starts at ${slot}.` });
    }
    // ESPN took it but its re-reads don't show it yet (APE-444): it usually has landed.
    if (r.ok && r.body.moves) {
      router.refresh();
      return fail(r.body, `${player.name} is on your team. ESPN took the change to start him at ${slot} but doesn't show it yet. Check your lineup in a minute.`);
    }
    fail(r.body, `${player.name} is on your team, but ESPN didn't start him at ${slot}.`, "start");
  }

  async function send() {
    if (!plan) return;
    const consent = agreed ? {} : { consentVersion: ESPN_WRITE_VERSION };

    if (plan.ir) {
      setPhase({ kind: "sending", step: `Moving ${name(plan.ir.move.playerId)} to IR…` });
      const r = await post(`${base}/apply`, { week: view.currentWeek, season: view.season, snapshot: plan.ir.snapshot, moves: [plan.ir.move], suggested: [], ...consent });
      if (r.body.consent) return consentLapsed();
      if (!r.ok || !r.body.moves?.every((m) => m.landed)) return fail(r.body, "ESPN didn't move him to IR. Nothing else was sent.");
      setAgreed(true);
    }

    setPhase({ kind: "sending", step: `Adding ${player.name}…` });
    const add = await post(`${base}/acquire`, { kind: "add", week: view.currentWeek, snapshot: plan.add.snapshot, add: plan.add.add, drop: plan.add.drop, ...(plan.ir ? {} : consent) });
    if (add.body.consent) return consentLapsed();
    if (!add.ok || !add.body.added) {
      router.refresh();
      return fail(add.body, `ESPN didn't add ${player.name}.${plan.ir ? ` ${name(plan.ir.move.playerId)} is on IR now.` : ""}`);
    }
    setAgreed(true);
    await start({});
  }

  function consentLapsed() {
    setAgreed(false);
    setConsenting(false);
    setPhase({ kind: "consent" });
  }

  const sending = phase.kind === "sending";
  const room = fill.ir !== null ? `${name(fill.ir)} goes to IR` : fill.drop !== null ? `Drops ${name(fill.drop)}` : "Room on your roster";
  return (
    <li className={s.fill} data-lead={lead || undefined} data-open={phase.kind !== "idle" || undefined}>
      <span className={s.fillWho}>
        <PlayerLine player={player} value="none" live />
        <span className={s.fillRoom}>{room}</span>
      </span>
      <span className={`${s.fillPts} tabular-nums`}>
        {pts(player.points)}
        <span className="sr-only"> projected</span>
      </span>
      {phase.kind !== "done" && (
        <div className={s.fillAct}>
          {/* The consent waits for the tap, so the hero isn't a wall of it. */}
          {phase.kind === "consent" && <WriteConsent checked={consenting} onChange={setConsenting} />}
          {phase.kind === "failed" && phase.retry === "start" ? (
            <button type="button" className={s.primary} onClick={() => start({})}>
              Start {player.name} at {slot}
            </button>
          ) : (
            <span className={s.fillButtons}>
              <button
                type="button"
                className={lead || phase.kind !== "idle" ? s.primary : s.button}
                onClick={() => (agreed || phase.kind === "consent" ? send() : setPhase({ kind: "consent" }))}
                disabled={sending || (phase.kind === "consent" && !consenting)}
              >
                {sending ? phase.step : `Add and start at ${slot}`}
              </button>
              {phase.kind === "consent" && (
                <button type="button" className={s.textButton} onClick={() => setPhase({ kind: "idle" })}>
                  Cancel
                </button>
              )}
            </span>
          )}
        </div>
      )}
      {phase.kind === "done" && (
        <p className={s.fillDone} role="status">
          {phase.message}
        </p>
      )}
      {phase.kind === "failed" && (
        <div className={`${s.applyProblems} ${s.fillProblem}`} role="alert">
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
    </li>
  );
}

/** The reader's clock to the minute, on the client only: the server renders as if kickoff were far off. */
let minute = 0;
function subscribeMinute(onChange: () => void) {
  const timer = setInterval(() => {
    minute = Date.now();
    onChange();
  }, 60_000);
  return () => clearInterval(timer);
}
function useNow(): number | null {
  return useSyncExternalStore(
    subscribeMinute,
    () => (minute ||= Date.now()),
    () => null,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A soft hole (APE-350): a starter ESPN expects to sit, or a DOUBTFUL one, with nobody behind him.
 * A note to keep an eye on, never a takeover. A day or more out it only says to check back; inside a
 * day it suggests a pickup.
 */
export function HoleNote({ view, holes, onWaivers, className }: { view: SeasonView; holes: readonly Hole[]; onWaivers: () => void; className?: string }) {
  const now = useNow();
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  if (!holes.length) return null;
  return (
    <ul className={`${s.holeNotes} ${className ?? ""}`}>
      {holes.map((hole) => {
        const p = roster.find((r) => r.playerId === hole.playerId);
        const kickoff = hole.kickoff ? Date.parse(hole.kickoff) : NaN;
        const soon = now !== null && Number.isFinite(kickoff) && kickoff - now < DAY_MS;
        const slot = label(hole.key);
        const who = p?.name ?? `Your ${slot}`;
        const why = hole.reason === "doubtful" ? "is doubtful" : "may sit: ESPN projects him for 0";
        return (
          <li key={`${hole.key}-${hole.playerId}`} className={s.holeNote}>
            <Warning className={s.holeNoteIcon} />
            <span>
              <b>{who}</b> {why}, with no backup at {slot}.{" "}
              {soon ? (
                <button type="button" className={s.textButton} onClick={onWaivers}>
                  Consider a pickup <ArrowRight className={s.holeArrow} />
                </button>
              ) : (
                "Check back closer to kickoff."
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
