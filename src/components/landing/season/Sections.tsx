"use client";

import type { CSSProperties } from "react";
import { stage as stageFont } from "@/components/draft/stageFont";
import { Check, Swap } from "@/components/season/Icons";
import { draftRoomLineup, lineupTotal, type SamplePlayer, type SeasonSample } from "@/lib/landing/seasonSample";
import { Count } from "./Count";
import { cx } from "./cx";
import { useStage } from "./stage";

/**
 * The season page's sections below the hero, in selling order (APE-340): the lineup first, because
 * knowing you started the right players is the reason to connect; then trades and pickups; then
 * game day and the recap, which keep you coming back. Every example is the hero's sample team, so
 * the page tells one week's story rather than five unrelated ones.
 *
 * Each section plays its payoff once as it scrolls in (stage.ts): the swaps land and the win chance
 * climbs past 50%; the player you get arrives and the gains count; the live score ticks up and the
 * recap's W lands. Each title carries one phrase in Signal Green, the hero's "we make sure" voice.
 */

const one = (n: number) => n.toFixed(1);
const pct = (p: number) => `${Math.round(p * 100)}%`;
const POS_CLASS: Record<string, string> = { QB: "qb", RB: "rb", WR: "wr", TE: "te", K: "k", DST: "dst" };
/** Per-element timing for the staged keyframes, in ms after the section plays. */
const at = (ms: number) => ({ "--at": `${ms}ms` }) as CSSProperties;

function PlayerLine({ player, struck = false }: { player: SamplePlayer; struck?: boolean }) {
  return (
    <span className={cx("pl")}>
      <span className={cx("plPos", POS_CLASS[player.pos])}>{player.pos === "DST" ? "D/ST" : player.pos}</span>
      <span className={cx("plName", struck && "struck")}>{player.name}</span>
      <span className={cx("plMeta")}>
        {player.team} {player.game}
      </span>
    </span>
  );
}

/** "Know you started the right guys": both lineups side by side, the gain, the win chance, and why. */
export function LineupProof({ sample }: { sample: SeasonSample }) {
  const ours = draftRoomLineup(sample);
  const gain = lineupTotal(ours) - lineupTotal(sample.lineup);
  const ref = useStage<HTMLElement>();
  const { before, after } = sample.winChance;
  return (
    <section ref={ref} className={cx("section", "proofSection")} aria-labelledby="proof-title">
      <div className={cx("sectionHead", "headCenter")}>
        <h2 id="proof-title" className={cx("title")}>
          Know you started the <span className={cx("titleWin")}>right guys</span>.
        </h2>
        <p className={cx("lede")}>
          Every week Draft Room reads your ESPN roster, scores it the way your league scores, and sets the lineup that projects the most points. When it would
          change something, it says so, and says why.
        </p>
      </div>

      <div className={cx("proof")}>
        <div className={cx("table")} role="table" aria-label="Your lineup set by rank, against Draft Room's">
          <div className={cx("tableHead")} role="row">
            <span role="columnheader">Slot</span>
            <span role="columnheader">By rank</span>
            <span role="columnheader">Draft Room</span>
          </div>
          {sample.lineup.map((row, i) => {
            const swap = sample.swaps.find((sw) => sw.slot === i);
            const n = swap ? sample.swaps.indexOf(swap) : 0;
            return (
              <div key={i} className={cx("tableRow", swap && "tableChanged")} role="row" style={swap ? at(250 + n * 380) : undefined}>
                <span className={cx("tableSlot", POS_CLASS[row.player.pos])} role="cell">
                  {row.slot}
                </span>
                {swap ? (
                  <>
                    <span role="cell" className={cx("tableCell")}>
                      <span className={cx("struck")}>{swap.out.name}</span>
                      <span className={cx("tableProj")}>{one(swap.out.proj)}</span>
                    </span>
                    <span role="cell" className={cx("tableCell", "tableIn")}>
                      <span>{swap.in.name}</span>
                      <span className={cx("tableProj")}>{one(swap.in.proj)}</span>
                    </span>
                  </>
                ) : (
                  <span role="cell" className={cx("tableCell", "tableKeep")}>
                    <span>{row.player.name}</span>
                    <span className={cx("tableProj")}>{one(row.player.proj)}</span>
                    <Check className={cx("keepIcon")} />
                  </span>
                )}
              </div>
            );
          })}
          <div className={cx("tableFoot")} role="row">
            <span role="cell">Total</span>
            <span role="cell" className={cx("tableCell")}>
              <span />
              <span className={cx("tableProj")}>{one(lineupTotal(sample.lineup))}</span>
            </span>
            <span role="cell" className={cx("tableCell", "tableIn")}>
              <span />
              <span className={cx("tableProj")}>
                <Count value={lineupTotal(ours)} from={lineupTotal(sample.lineup)} delay={300} ms={1100} />
              </span>
            </span>
          </div>
        </div>

        <div className={cx("verdict")}>
          <div className={cx("ladder")} style={at(250)}>
            <b>
              <Count value={gain} prefix="+" delay={300} ms={1100} />
            </b>
            <span>projected points this week</span>
          </div>
          <div className={cx("swing")}>
            <div className={cx("swingRow")}>
              <span>By rank</span>
              <div className={cx("swingBar")}>
                <span style={{ transform: `scaleX(${before})` }} />
              </div>
              <b>{pct(before)}</b>
            </div>
            <div className={cx("swingRow", "swingOurs")}>
              <span>Draft Room</span>
              {/* Draft Room's bar starts where rank left it and climbs past the 50% line. */}
              <div className={cx("swingBar")}>
                <span className={cx("swingClimb")} style={{ transform: `scaleX(${after})`, "--from": before, ...at(700) } as CSSProperties} />
              </div>
              <b>
                <Count value={after * 100} from={before * 100} digits={0} suffix="%" delay={750} ms={1000} />
              </b>
            </div>
            <p className={cx("swingNote")}>Chance to beat {sample.opponent} this week. The line is a coin flip.</p>
          </div>
          <ul className={cx("whys")}>
            {sample.swaps.map((sw, i) => (
              <li key={sw.slot} style={at(1100 + i * 140)}>
                <b>
                  Start <span className={cx("whyIn")}>{sw.in.name}</span> over {sw.out.name}.
                </b>{" "}
                ESPN projects him for {one(sw.in.proj)} {sw.in.game}, and {sw.out.name.split(" ").at(-1)} for {one(sw.out.proj)} {sw.out.game}.
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Trades and pickups, side by side: the analyst working the rest of the roster. */
export function Moves({ sample }: { sample: SeasonSample }) {
  const { trade, waiver } = sample;
  const ref = useStage<HTMLElement>();
  return (
    <section ref={ref} className={cx("section")} aria-labelledby="moves-title">
      <div className={cx("headSplit")}>
        <h2 id="moves-title" className={cx("title")}>
          Then it works the <span className={cx("titleSky")}>rest of your roster</span>.
        </h2>
        <p className={cx("lede")}>Trades both teams should take, and the pickups worth a roster spot, checked against your real roster every week.</p>
      </div>

      <div className={cx("moves")}>
        <article className={cx("move")}>
          <header className={cx("moveHead")}>
            <h3>Trade idea</h3>
            <span className={cx("winWin")} style={at(900)}>
              Win-win
            </span>
          </header>
          {/* The exchange reads left to right: what leaves your bench, the swap, what joins your lineup. */}
          <div className={cx("exchange")}>
            <div className={cx("sendSide")} style={at(100)}>
              <span className={cx("sideLabel")}>You send</span>
              {trade.send.map((p) => (
                <PlayerLine key={p.name} player={p} />
              ))}
            </div>
            <span className={cx("hub")} style={at(350)} aria-hidden="true">
              <Swap className={cx("hubIcon")} />
            </span>
            <div className={cx("getSide")} style={at(550)}>
              <span className={cx("sideLabel")}>You get</span>
              {trade.get.map((p) => (
                <PlayerLine key={p.name} player={p} />
              ))}
            </div>
          </div>
          <p className={cx("moveGain")}>
            <b>
              <Count value={trade.gain.you} prefix="+" delay={450} />
            </b>{" "}
            a week for you <span>·</span> +{one(trade.gain.partner)} for {trade.partner}
          </p>
          <p className={cx("why")}>{trade.why}</p>
        </article>

        <article className={cx("move")}>
          <header className={cx("moveHead")}>
            <h3>Pickup</h3>
            <span className={cx("ownedTag")}>{waiver.owned}% rostered</span>
          </header>
          {/* The same exchange, top to bottom: who comes off the wire, who makes room. */}
          <div className={cx("getSide", "pickup")} style={at(300)}>
            <span className={cx("sideLabel")}>Free agent: add now</span>
            <div className={cx("pickupRow")}>
              <PlayerLine player={waiver.add} />
              <div className={cx("pickupGain")}>
                <b>
                  <Count value={waiver.gain} prefix="+" delay={450} />
                </b>
                <span>this week</span>
              </div>
            </div>
          </div>
          <div className={cx("sendSide", "dropBox")} style={at(150)}>
            <span className={cx("sideLabel")}>Drop, your lowest-ranked bench player</span>
            <PlayerLine player={waiver.drop} struck />
          </div>
          <p className={cx("why")}>
            Most leagues have left {waiver.add.name} on the wire. ESPN projects him for {one(waiver.add.proj)} {waiver.add.game}.
          </p>
        </article>
      </div>
    </section>
  );
}

/** Game day and the recap, as one compact strip: the reason to keep the page open on Sunday. */
export function GameDayStrip({ sample }: { sample: SeasonSample }) {
  const lead = 15.3;
  const swing = sample.final.you - sample.final.opponent;
  const star = sample.swaps.find((sw) => sw.in.name === sample.star.name)?.in;
  const role = star?.pos === "RB" ? "the back" : star?.pos === "WR" ? "the receiver" : "the player";
  const ref = useStage<HTMLElement>();
  const mine = sample.final.you - 21.4;
  return (
    <section ref={ref} className={cx("section", "night")} aria-labelledby="gameday-title">
      <span className={cx("flood", "floodLeft")} aria-hidden="true" />
      <span className={cx("flood", "floodRight")} aria-hidden="true" />
      <div className={cx("nightInner")}>
        <div className={cx("nightHead")}>
          <h2 id="gameday-title" className={cx("title")}>
            And it stays with you through <span className={cx("titleWin")}>Sunday night</span>.
          </h2>
          <ul className={cx("nightList")}>
            <li>Live points for every starter, with the pace each one is on.</li>
            <li>Every Wednesday, a recap of your whole league&apos;s week.</li>
          </ul>
        </div>
        <div className={cx("gameday")}>
          <div className={cx("live")}>
            <span className={cx("liveTag")}>
              <span className={cx("liveDot")} aria-hidden="true" />
              Live
            </span>
            <div className={cx("liveScores")}>
              <div>
                <span>{sample.you}</span>
                <b className={cx("liveMine")}>
                  <Count value={mine} from={mine - 30} delay={200} ms={1600} />
                </b>
              </div>
              <div>
                <span>{sample.opponent}</span>
                <b>
                  <Count value={mine - lead} from={mine - lead - 30} delay={200} ms={1600} />
                </b>
              </div>
            </div>
            <p className={cx("liveLead")}>
              Up {one(lead)} <span>· 2 of your starters still to play</span>
            </p>
            <div className={cx("liveBar")} aria-hidden="true">
              <span className={cx("liveClimb")} style={{ transform: "scaleX(0.84)", ...at(200) }} />
            </div>
          </div>
          <div className={cx("recap")}>
            <h3>
              <span className={`${cx("wBadge")} ${stageFont.variable}`} aria-hidden="true" style={at(900)}>
                W
              </span>
              Why you won
            </h3>
            <p>
              Set by rank, your lineup was projected to lose by {one(sample.opponentProj - lineupTotal(sample.lineup))}. You won by {one(swing)}, and{" "}
              {sample.star.name}, {role} Draft Room started, gave you {one(sample.star.points)}.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
