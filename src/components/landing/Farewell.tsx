"use client";

import { forwardRef } from "react";
import { dataset } from "@/lib/data";
import { roundOf } from "@/lib/draft/snake";
import { farewellMood, isDone, isUnfinished, type Farewell, type FarewellLeague } from "@/lib/storage";
import { cx, s } from "./cx";

/** More than this and the rest are counted, not listed: the panel is a goodbye, not a dashboard. */
const SHOWN = 3;
const players = new Map(dataset.players.map((p) => [p.id, p]));

/**
 * The entry panel's goodbye, after signing out (see AccountMenu): walking out of the draft room
 * with your card in hand. A paused draft shows where its clock stopped, one square per round, so
 * coming back is the obvious next move; a finished one shows the core of the team you drafted and
 * sends you into the season; with nothing drafted, it just says see you on draft day.
 *
 * `farewell` is undefined for the moment between the first paint and reading the hand-off, when
 * the face holds its place empty rather than flash the wrong goodbye.
 */
export const FarewellFace = forwardRef<HTMLHeadingElement, { farewell: Farewell | null | undefined; onSignIn(): void; onNewDraft(): void }>(
  function FarewellFace({ farewell, onSignIn, onNewDraft }, heading) {
    if (farewell === undefined) return <div className={s.face} aria-busy="true" />;

    const mood = farewellMood(farewell);
    const who = farewell?.email ? (
      <>
        Signed out of <b className={s.fwEmail}>{farewell.email}</b>.
      </>
    ) : (
      "Signed out."
    );
    const unfinished = farewell?.leagues.filter(isUnfinished) ?? [];
    const done = farewell?.leagues.filter(isDone) ?? [];
    const season = done[0]?.season;

    return (
      <div className={s.face}>
        {mood === "unfinished" ? (
          <>
            <h1 className={s.thesis} ref={heading} tabIndex={-1}>
              Your seat is saved.
            </h1>
            <p className={s.sub}>{who} The clock is paused. Sign back in and pick up right where you left off.</p>
            <ul className={s.fwPaused}>
              {unfinished.slice(0, SHOWN).map((l, i) => (
                <Paused key={i} league={l} />
              ))}
            </ul>
            <More n={unfinished.length - SHOWN} what="paused draft" />
          </>
        ) : mood === "done" ? (
          <>
            <h1 className={s.thesis} ref={heading} tabIndex={-1}>
              That&apos;s a wrap.
              <br />
              <em>Go win it all.</em>
            </h1>
            <p className={s.sub}>
              {who} Here&apos;s to the {season} season.
            </p>
            <div className={s.fwTeams}>
              {done.slice(0, 2).map((l, i) => (
                <TeamCard key={i} league={l} delay={i * 160} />
              ))}
            </div>
            <More n={done.length - 2} what="drafted team" />
          </>
        ) : (
          <>
            <h1 className={s.thesis} ref={heading} tabIndex={-1}>
              See you on draft day.
            </h1>
            <p className={s.sub}>{who} Your leagues are saved to your account, ready when you are.</p>
          </>
        )}

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
 * A paused draft: its name, where the clock stopped, and a track of one square per round — played
 * rounds filled in the done tone, the round it paused in outlined amber (the room's "near").
 */
function Paused({ league: l }: { league: FarewellLeague }) {
  const round = roundOf(l.logged + 1, l.teams);
  const played = Math.floor(l.logged / l.teams);
  return (
    <li className={s.fwLeague}>
      <div className={s.fwLeagueHead}>
        <b>{l.name}</b>
        <span>
          Round {round} · {l.logged} of {l.total} picks in
        </span>
      </div>
      <div className={s.fwTrack} aria-hidden="true">
        {Array.from({ length: l.rounds }, (_, i) => (
          <i key={i} className={cx(i < played && "played", i === played && "paused")} style={{ animationDelay: `${i * 40}ms` }} />
        ))}
      </div>
    </li>
  );
}

/** A finished draft's card: the mine ✓ stamped in, then the first picks as the board's own mine rows. */
function TeamCard({ league: l, delay }: { league: FarewellLeague; delay: number }) {
  const core = l.mine.map((id) => players.get(id)).filter((p) => p !== undefined);
  return (
    <article className={s.fwTeam} style={{ animationDelay: `${delay}ms` }}>
      <div className={s.fwTeamHead}>
        <span className={s.fwCheck} aria-hidden="true">
          ✓
        </span>
        <div>
          <b>{l.name}</b>
          <span>
            Drafted · {l.teams} teams · {l.rounds} rounds
          </span>
        </div>
      </div>
      {core.length > 0 && (
        <ol className={s.fwCore} aria-label="Your first picks">
          {core.map((p) => (
            <li key={p.id} className={cx("card", p.pos, "mine")}>
              <span className={s.rank}>✓</span>
              <span className={s.name}>{p.name}</span>
              <span className={s.meta}>
                {p.pos === "DST" ? "D/ST" : p.pos} · {p.team}
              </span>
              <span />
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function More({ n, what }: { n: number; what: string }) {
  if (n <= 0) return null;
  return (
    <p className={s.fwMore}>
      and {n} more {what}
      {n === 1 ? "" : "s"}
    </p>
  );
}
