"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMediaQuery } from "@/components/draft/useMediaQuery";
import type { PublicFlags } from "@/lib/config";
import { dataset } from "@/lib/data";
import { LATE_POSITIONS, type LeagueSettings } from "@/lib/draft/types";
import { valueTag } from "@/lib/draft/value";
import { getStores, takeFarewell, type Farewell } from "@/lib/storage";
import { cx, s } from "./cx";
import { EntryPanel, startingLeague } from "./EntryPanel";
import { LiveBoard } from "./LiveBoard";
import { OnTheClock } from "./OnTheClock";
import { TurnPlanProof } from "./TurnPlanProof";
import { useFirstTurnPlan } from "./useFirstTurnPlan";
import { useLiveMock } from "./useLiveMock";

const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * The hosted site's front door: a draft already running, with the pick you'd get landing on it.
 *
 * Written for people who want to use something, not set something up — someone who barely follows
 * football and wants to be told who to take, and someone running five drafts this week who wants
 * them all in one place. No page copy is about how it's built.
 *
 * Anyone who has been here before never sees it: a signed-in session is forwarded on the server,
 * and a league saved on this device is forwarded as soon as the stores answer.
 */
export function Landing({ flags, farewell = false }: { flags: PublicFlags; farewell?: boolean }) {
  const router = useRouter();
  const [league, setLeague] = useState<LeagueSettings>(startingLeague);
  const reduced = useMediaQuery(REDUCED);

  /**
   * Returning local user: straight to their board. The page renders first and redirects when the
   * stores answer, rather than holding the markup behind a storage round trip — a door that ships
   * an empty document to a crawler, or to anyone without JavaScript, is not a door.
   */
  useEffect(() => {
    // Just signed out: stay for the goodbye, even with leagues saved on this device.
    if (farewell) return;
    let live = true;
    void getStores()
      .league.listLeagues()
      .then((leagues) => {
        if (live && leagues.length) router.replace(`/draft${window.location.search}`);
      });
    return () => {
      live = false;
    };
  }, [router, farewell]);

  /*
   * The goodbye's contents, handed over by the sign-out in this tab's sessionStorage. Read (and
   * the `?farewell=1` stripped) from a timeout: an effect cleaned up before it fires, as React's
   * development double-run does, then retries rather than losing the one-time hand-off.
   */
  const [goodbye, setGoodbye] = useState<Farewell | null | undefined>(undefined);
  useEffect(() => {
    if (!farewell) return;
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("farewell");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      setGoodbye(takeFarewell());
    }, 0);
    return () => clearTimeout(t);
  }, [farewell]);

  const mock = useLiveMock(league, reduced);
  const first = useFirstTurnPlan(league, mock.full);
  const shape = `${league.teams}-${league.mySlot}-${league.scoring}`;
  const planForSale = flags.aiEnabled && flags.paymentsEnabled;

  return (
    <main className={s.root}>
      <div className={s.hero} id="top">
        {/*
          * Keyed by league shape so a change re-deals the board rather than silently swapping
          * its contents: every card replays its staggered entrance, which is what makes the
          * page's signature interaction something a visitor can actually see happen.
          */}
        <LiveBoard key={`${shape}-${mock.deal}`} league={league} mock={mock} reduced={reduced} />
        <div className={s.veil} aria-hidden="true" />
        <div className={s.heroInner}>
          <EntryPanel flags={flags} league={league} onLeague={setLeague} openOn={farewell ? "farewell" : "draft"} farewell={goodbye} />
          <OnTheClock key={`${shape}-${mock.deal}`} league={league} mock={mock} first={first} />
        </div>
        <p className={s.dataNote}>{dataset.label}</p>
      </div>

      <TurnPlanProof league={league} first={first} />

      <section className={s.forWho} aria-labelledby="forwho-title">
        <h2 id="forwho-title" className={s.proofTitle}>
          Whether it&apos;s your first draft or your fifth this week.
        </h2>
        <div className={s.forWhoGrid}>
          <article className={s.persona}>
            <h3>Don&apos;t follow football much?</h3>
            <p>
              You don&apos;t need to know the players. The board ranks them for your league, marks the steals and the overpays, and when it&apos;s your turn
              it shows you who to take and who&apos;ll still be there next time.
            </p>
            {planForSale && (
              <p className={s.personaPlus}>
                <b>Season pass:</b> an AI-written plan for your exact draft slot, round by round, so you walk in knowing what to do.
              </p>
            )}
          </article>
          <article className={s.persona}>
            <h3>Running a lot of drafts?</h3>
            <p>
              Every league you set up lives in one account, on your phone and your laptop. Log picks as they happen on whatever site your league drafts
              on, and the plan updates after every one. Switch leagues from the top of the board.
            </p>
            {planForSale && (
              <p className={s.personaPlus}>
                <b>Season pass:</b> one per league, one time for the whole season. No subscription.
              </p>
            )}
          </article>
          {flags.espnSeasonOpen && (
            <article className={s.persona}>
              <h3>Already drafted on ESPN?</h3>
              <p>
                Connect your ESPN league once and War Room sets your best lineup every week and checks any trade against both teams&apos; real rosters,
                for the rest of the season. Free.
              </p>
            </article>
          )}
        </div>
      </section>

      <Verdicts league={league} />

      <section className={s.close}>
        <h2 className={s.proofTitle}>Walk in knowing what comes back to you.</h2>
        <p className={s.closeSub}>Tell it your league and your slot. A practice draft starts before you finish reading this.</p>
        <a className={cx("btn", "primary")} href="#top">
          Set up my draft ↑
        </a>
      </section>

      <footer className={s.footer}>
        <div className={s.footerMain}>
          <b>Fantasy War Room</b>
          <p>
            The board, the practice drafts and the pick-by-pick plan are free.
            {planForSale ? " A season pass adds the AI-written plan for one league." : ""} An account keeps your leagues in sync on every device.
          </p>
        </div>
        <p className={s.fine}>
          Player rankings: {dataset.label}. Average draft positions from {dataset.adpSource}.
        </p>
      </footer>
    </main>
  );
}

/**
 * Three things the board says on every player, in words someone new to fantasy can use, shown on
 * players the loaded rankings actually have.
 */
function Verdicts({ league }: { league: LeagueSettings }) {
  const examples = useMemo(() => {
    const rated = dataset.players
      .filter((p) => !LATE_POSITIONS.includes(p.pos) && p.consensusRank <= 80)
      .map((p) => ({ p, tag: valueTag(p, league.valueThreshold) }));
    const best = rated.reduce((a, b) => (b.tag.delta > a.tag.delta ? b : a));
    const worst = rated.reduce((a, b) => (b.tag.delta < a.tag.delta ? b : a));
    return { best, worst };
  }, [league.valueThreshold]);

  return (
    <section className={s.verdicts} aria-labelledby="verdicts-title">
      <div className={s.proofHead}>
        <h2 id="verdicts-title" className={s.proofTitle}>
          Every player comes with a verdict.
        </h2>
      </div>
      <div className={s.verdictGrid}>
        <article className={s.verdict}>
          <h3>
            A steal <span className={cx("tag", "value")}>+{examples.best.tag.delta} Value</span>
          </h3>
          <p>
            Experts rank <b>{examples.best.p.name}</b> {examples.best.p.consensusRank}th, but most drafts take him around pick {examples.best.p.adp}.
            If he&apos;s still there, that&apos;s your moment.
          </p>
        </article>
        <article className={s.verdict}>
          <h3>
            An overpay <span className={cx("tag", "reach")}>{examples.worst.tag.delta} Reach</span>
          </h3>
          <p>
            <b>{examples.worst.p.name}</b> usually goes {Math.abs(examples.worst.tag.delta)} picks earlier than the experts would take him. You&apos;ll
            know before you spend the pick.
          </p>
        </article>
        <article className={s.verdict}>
          <h3>
            A bad week <span className={cx("tag", "warn")}>⚠ Bye</span>
          </h3>
          <p>
            Take too many starters who sit out the same week and that week is lost. The board warns you on the player, before you pick him.
          </p>
        </article>
      </div>
    </section>
  );
}
