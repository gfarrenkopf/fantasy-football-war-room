"use client";

import { useMemo } from "react";
import { dataset } from "@/lib/data";
import { formatRoundPick, isMyPick, nextMyPick, roundOf, totalPicks } from "@/lib/draft/snake";
import type { LeagueSettings, Player } from "@/lib/draft/types";
import { valueTag, valueTagLabel } from "@/lib/draft/value";
import { cx, s } from "./cx";
import { PLAN_MOCKS, type FirstTurnPlan } from "./useFirstTurnPlan";
import type { LiveMock } from "./useLiveMock";

const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
};

const byId = new Map(dataset.players.map((p) => [p.id, p]));

/** Picks shown in the running team list. */
const TEAM_SHOWN = 4;

/**
 * The part of a draft people actually remember: the room coming round to you, and your name
 * landing on a player.
 *
 * A turn banner counts the landing board's mock down to the visitor's slot in the war room's own
 * escalation grammar — muted while the room is far away, amber as it closes in, green on the
 * clock — and when the simulator makes the visitor's pick, the war room's pick card lands on it:
 * the ✓ stamped in, one pass of light, and the one thing no other draft tool can say at that
 * moment — who is likely to still be there when the snake comes back. After it has been read,
 * the card settles into a running list of the visitor's team.
 *
 * It adds no animated glow: DESIGN.md holds the product to two, and both live in the war room.
 */
export function OnTheClock({ league, mock, first }: { league: LeagueSettings; mock: LiveMock; first: FirstTurnPlan }) {
  const { full, revealed } = mock;
  const total = totalPicks(league);
  const current = Math.min(revealed + 1, total);
  const done = revealed >= full.length && full.length > 0;

  const mine = useMemo(() => {
    const out: { player: Player; n: number }[] = [];
    for (let i = 0; i < revealed; i++) {
      const p = full[i].mine ? byId.get(full[i].playerId) : undefined;
      if (p) out.push({ player: p, n: i + 1 });
    }
    return out;
  }, [full, revealed]);

  // The card is live while your pick is the newest thing on the board (the room holds for it),
  // and for the one pick after; then it settles into the team list.
  const last = mine.at(-1);
  const live = !!last && revealed - last.n <= 1;

  const onClock = !done && isMyPick(current, league);
  const next = nextMyPick(current, league);
  const until = next - current;
  const state = live ? "picked" : done ? "far" : onClock ? "onclock" : until <= 2 ? "near" : "far";

  // While your pick is being read, the banner stays on your pick rather than racing ahead.
  const shown = live && last ? last.n : current;
  const round = roundOf(shown, league.teams);
  const first0 = (round - 1) * league.teams + 1;
  const pips = Array.from({ length: league.teams }, (_, i) => first0 + i);

  if (!full.length) return null;

  return (
    <div className={cx("clock", live && "live")} aria-hidden="true">
      <div className={cx("turn", state)}>
        {/* Keyed by state so the light passes once on each arrival, never on a loop. */}
        {(state === "onclock" || state === "picked") && <div key={`${state}-${shown}`} className={s.sweep} />}
        <div className={s.turnLabel}>
          Mock draft · {league.teams} teams · you pick {ordinal(league.mySlot)}
        </div>
        <div className={s.turnMain}>
          <b className={s.turnNum}>
            {done && !live ? "Draft over" : <>Pick {shown}</>}
            {!(done && !live) && <span>{formatRoundPick(shown, league.teams)}</span>}
          </b>
          <span className={s.turnSay}>
            {live
              ? "Your pick is in"
              : done
              ? "That's the whole draft."
              : onClock
                ? "You're on the clock"
                : next > total
                  ? "You're done picking"
                  : until === 1
                    ? "You're up next"
                    : `${until} picks until you're up`}
          </span>
        </div>
        <ol className={s.pips}>
          {pips.map((n) => {
            const yours = isMyPick(n, league);
            return <li key={n} className={cx("pip", n < shown && "past", n === shown && !done && "now", yours && "yours", yours && n <= revealed && "got")} />;
          })}
        </ol>
      </div>

      {last && live ? (
        <PickCard key={last.n} league={league} player={last.player} n={last.n} first={first} isFirst={mine.length === 1} />
      ) : mine.length > 0 ? (
        <div className={s.team}>
          <span className={s.teamLabel}>Your team</span>
          <ul>
            {/* The latest few: a whole roster down the side of the page is a list, not a moment. */}
            {mine.length > TEAM_SHOWN && (
              <li className={s.teamMore}>
                +{mine.length - TEAM_SHOWN} earlier pick{mine.length - TEAM_SHOWN === 1 ? "" : "s"}
              </li>
            )}
            {mine.slice(-TEAM_SHOWN).map(({ player, n }) => (
              <li key={n} className={cx("teamRow", player.pos)}>
                <span>{player.name}</span>
                <i>{formatRoundPick(n, league.teams)}</i>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PickCard({ league, player: p, n, first, isFirst }: { league: LeagueSettings; player: Player; n: number; first: FirstTurnPlan; isFirst: boolean }) {
  const tag = valueTag(p, league.valueThreshold);
  const verdict = tag.kind === "value" || tag.kind === "reach";
  const next = nextMyPick(n + 1, league);
  const total = totalPicks(league);
  // The mechanism, at the moment it matters: only the first pick has a computed plan behind it.
  const target = isFirst ? first.plan?.targets[0] : undefined;
  const pct = target ? Math.round(target.survival * 100) : null;

  return (
    <div className={cx("pickCard", p.pos)}>
      <div className={s.pcHead}>
        <span className={s.pcCheck}>✓</span>
        <div className={s.pcWho}>
          <b className={s.pcName}>{p.name}</b>
          <span className={s.pcMeta}>
            <i className={cx("pcPos", p.pos)}>{p.pos}</i>
            {p.team} · bye {p.bye}
            {verdict && <span className={cx("tag", tag.kind)}>{valueTagLabel(tag)}</span>}
          </span>
        </div>
        <div className={s.pcPick}>
          <b>#{n}</b>
          <span>{formatRoundPick(n, league.teams)}</span>
        </div>
      </div>
      <p className={s.pcNext}>
        {next > total ? (
          "That was your last pick."
        ) : target && pct !== null ? (
          <>
            Back at pick {next}: <b>{target.player.name}</b> should still be there. {pct}% of {PLAN_MOCKS} mocks say so.
          </>
        ) : (
          <>
            Back at pick {next}, {next - n} picks from now.
          </>
        )}
      </p>
      <i className={s.pcLife} />
    </div>
  );
}
