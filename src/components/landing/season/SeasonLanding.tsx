"use client";

import type { PublicFlags } from "@/lib/config";
import type { SeasonSample } from "@/lib/landing/seasonSample";
import { s as door } from "../cx";
import { EntryPanel, startingLeague } from "../EntryPanel";
import { useDoor } from "../useDoor";
import { Close } from "./Close";
import { cx } from "./cx";
import { LeagueBackdrop } from "./LeagueBackdrop";
import { GameDayStrip, LineupProof, Moves } from "./Sections";
import { WinCard } from "./WinCard";

/**
 * The hosted site's front door during the NFL season (APE-340). The draft page sells a draft that's
 * already over for most visitors, so from week 1 to the fantasy final the door sells the season:
 * Draft Room as the analyst who makes sure you start the team that wins.
 *
 * Same door, same conventions as the draft page: a hero that shows the product working rather than
 * describing it (a week won, and the calls that won it), the entry panel holding the whole
 * decision, and the sections below carrying the same claims as text. It is static marketing: the
 * sample week is a committed file, refreshed once a season by scripts/season-sample.mts.
 */
export function SeasonLanding({ flags, sample, farewell = false }: { flags: PublicFlags; sample: SeasonSample; farewell?: boolean }) {
  const goodbye = useDoor(farewell);

  return (
    <main className={door.root}>
      <div className={cx("hero")} id="top">
        <LeagueBackdrop sample={sample} />
        <div className={door.veil} aria-hidden="true" />
        <div className={cx("heroInner")}>
          <EntryPanel flags={flags} league={NO_LEAGUE} onLeague={ignore} openOn={farewell ? "farewell" : "draft"} farewell={goodbye} season />
          <WinCard sample={sample} />
        </div>
      </div>

      <LineupProof sample={sample} />
      <Moves sample={sample} />
      <GameDayStrip sample={sample} />

      <section className={`${door.forWho} ${cx("personas")}`} aria-labelledby="forwho-title">
        <h2 id="forwho-title" className={door.proofTitle}>
          However seriously you take your league.
        </h2>
        <div className={cx("personaGrid")}>
          <article className={`${door.persona} ${cx("personaWin")}`}>
            <h3>Playing to win?</h3>
            <p>
              You play to win the game. So <b>why leave points on your bench?</b> Draft Room checks every starter against this week&apos;s projections and tells
              you the moves that make your team better, before your league does.
            </p>
          </article>
          <span className={cx("or")}>or</span>
          <article className={`${door.persona} ${cx("personaEase")}`}>
            <h3>Does it feel like a job?</h3>
            <p>
              Let Draft Room take you all the way. Your lineup, trades and waiver pickups, worked out for you each week, so all that&apos;s left is{" "}
              <b>making the moves and watching the points come in.</b>
            </p>
          </article>
        </div>
      </section>

      <Close season={sample.season} />

      <footer className={door.footer}>
        <div className={door.footerMain}>
          <b>Draft Room</b>
          <p>Lineups, trades and waiver pickups for your ESPN fantasy football league, every week of the season.</p>
        </div>
        <p className={door.fine}>Projections from ESPN. Draft Room isn&apos;t affiliated with ESPN.</p>
      </footer>
    </main>
  );
}

/** The panel's draft face never shows in season: it holds the default league, and nothing edits it. */
const NO_LEAGUE = startingLeague();
const ignore = () => {};
