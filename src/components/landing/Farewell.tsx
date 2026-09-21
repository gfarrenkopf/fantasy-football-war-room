"use client";

import { forwardRef } from "react";
import { dataset } from "@/lib/data";
import { roundOf } from "@/lib/draft/snake";
import { farewellMood, farewellOrder, stageOf, type Farewell, type FarewellLeague, type LeagueStage } from "@/lib/storage";
import { cx, s } from "./cx";

/** More than this and the rest are counted, not listed: the panel is a goodbye, not a dashboard. */
const SHOWN = 4;
/** Per-square delay as a track fills: a round every 28ms, so a 16-round draft fills in under half a second. */
const STEP = 28;
/** Per-row delay, so the list reads top to bottom. */
const ROW = 90;

const players = new Map(dataset.players.map((p) => [p.id, p]));

const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
};
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The entry panel's goodbye, after signing out (see AccountMenu): walking out of the draft room
 * with your card in hand. Every league gets a line and a track of one square per round, in the
 * order that matters on the way out: paused drafts first (where each clock stopped, the reason to
 * come back), then finished ones (the track runs green to a stamped ✓, with the picks that anchor
 * the team), then the ones still waiting for draft day. The headline follows the most pressing.
 *
 * `farewell` is undefined for the moment between the first paint and reading the hand-off, when
 * the face holds its place empty rather than flash the wrong goodbye.
 */
export const FarewellFace = forwardRef<HTMLHeadingElement, { farewell: Farewell | null | undefined; onSignIn(): void; onNewDraft(): void }>(
  function FarewellFace({ farewell, onSignIn, onNewDraft }, heading) {
    if (farewell === undefined) return <div className={s.face} aria-busy="true" />;

    const mood = farewellMood(farewell);
    const leagues = farewellOrder(farewell?.leagues ?? []);
    const tally = { paused: 0, done: 0, waiting: 0 };
    for (const l of leagues) tally[stageOf(l)]++;
    const said = [
      tally.paused && count(tally.paused, "draft") + " paused",
      tally.done && `${tally.done} in the books`,
      tally.waiting && `${tally.waiting} still to come`,
    ].filter(Boolean);
    // Nothing drafted yet: the lines below say it, and "1 still to come" would only repeat them.
    const summary = said.length && mood !== "fresh" ? `${said.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "";
    const who = farewell?.email ? (
      <>
        Signed out of <b className={s.fwEmail}>{farewell.email}</b>.
      </>
    ) : (
      "Signed out."
    );
    const season = leagues.find((l) => stageOf(l) === "done")?.season ?? leagues[0]?.season;

    return (
      <div className={s.face}>
        <h1 className={s.thesis} ref={heading} tabIndex={-1}>
          {mood === "unfinished" ? (
            "Your seat is saved."
          ) : mood === "done" ? (
            <>
              That&apos;s a wrap.
              <br />
              <em>Go win it all.</em>
            </>
          ) : (
            "See you on draft day."
          )}
        </h1>
        <p className={s.sub}>
          {who} {summary}{" "}
          {mood === "unfinished"
            ? "Sign back in and pick up right where you left off."
            : mood === "done"
              ? `Here's to the ${season} season.`
              : "Your leagues are saved to your account, ready when you are."}
        </p>

        {leagues.length > 0 && (
          <ul className={s.fwLeagues}>
            {leagues.slice(0, SHOWN).map((l, i) => (
              <LeagueLine key={i} league={l} delay={i * ROW} />
            ))}
          </ul>
        )}
        {leagues.length > SHOWN && <p className={s.fwMore}>and {count(leagues.length - SHOWN, "more league")}</p>}

        <div className={s.fwActions}>
          <button type="button" className={cx("btn", "primary", "wide")} onClick={onSignIn}>
            Sign back in →
          </button>
          <button type="button" className={s.linkBtn} onClick={onNewDraft}>
            Start a new draft
          </button>
        </div>
      </div>
    );
  },
);

/**
 * One league on the way out. The track is one square per round, the pick track's vocabulary:
 * - paused: played rounds in the done tone, the round the clock stopped in outlined amber (the
 *   room's "near": approaching, not alarming);
 * - done: every round runs mine green, left to right, and a ✓ is stamped at the end of the run;
 * - waiting: an empty track, with draft day's first round outlined sky.
 */
function LeagueLine({ league: l, delay }: { league: FarewellLeague; delay: number }) {
  const stage = stageOf(l);
  const played = Math.floor(l.logged / l.teams);
  const status: Record<LeagueStage, string> = {
    paused: `Round ${roundOf(l.logged + 1, l.teams)} · ${l.logged} of ${l.total} picks in`,
    done: `Drafted · ${l.rounds} rounds`,
    waiting: `Not started · you pick ${ordinal(l.slot)}`,
  };
  const core = stage === "done" ? l.mine.map((id) => players.get(id)).filter((p) => p !== undefined) : [];
  const finish = delay + l.rounds * STEP;

  return (
    <li className={cx("fwLeague", stage)} style={{ animationDelay: `${delay}ms`, "--sweep-at": `${finish + 200}ms` } as React.CSSProperties}>
      <div className={s.fwLeagueHead}>
        <b>{l.name}</b>
        <span>{status[stage]}</span>
      </div>
      <div className={s.fwTrack} aria-hidden="true">
        {Array.from({ length: l.rounds }, (_, i) => (
          <i
            key={i}
            className={cx(
              stage === "paused" && i < played && "played",
              stage === "paused" && i === played && "paused",
              stage === "done" && "won",
              stage === "waiting" && i === 0 && "ready",
            )}
            style={{ animationDelay: `${delay + i * STEP}ms` }}
          />
        ))}
        {stage === "done" && (
          <b className={s.fwStamp} style={{ animationDelay: `${finish + 60}ms` }}>
            ✓
          </b>
        )}
      </div>
      {core.length > 0 && (
        <p className={s.fwCore}>
          <span className={s.srOnly}>Your first picks: </span>
          {core.map((p) => (
            <span key={p.id} className={s.fwPick} style={{ "--pos": `var(--color-${p.pos.toLowerCase()})` } as React.CSSProperties}>
              <i>{p.pos === "DST" ? "D/ST" : p.pos}</i>
              {p.name}
            </span>
          ))}
        </p>
      )}
    </li>
  );
}
