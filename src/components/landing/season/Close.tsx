"use client";

import { stage as stageFont } from "@/components/draft/stageFont";
import { s as door } from "../cx";
import { ConnectEspn } from "./ConnectEspn";
import { cx } from "./cx";
import { useStage } from "./stage";

/**
 * The season page's last ask, staged as the trophy: a gold championship banner, the kind that
 * hangs in the rafters, with the visitor's team already on it. It lowers once as it scrolls in,
 * and a glint of gold runs across it whenever the visitor reaches for "Connect your ESPN league".
 * Gold is the door's winners' color (the "Exclusive" tag); the button itself stays Signal Green.
 */
export function Close({ season }: { season: number }) {
  const ref = useStage<HTMLElement>();
  return (
    <section ref={ref} className={cx("close")} aria-labelledby="close-title">
      <div className={cx("closeText")}>
        <h2 id="close-title" className={door.proofTitle}>
          Sunday&apos;s coming. Start the team that <span className={cx("titleGold")}>wins it</span>.
        </h2>
        <p className={door.closeSub}>Connect your ESPN league once, and Draft Room has your lineup ready every week.</p>
        <ConnectEspn className={cx("closeCta")} />
        <p className={cx("late")}>
          Drafting late? <a href="/draft">Open the Draft Room</a>
        </p>
      </div>

      <figure className={cx("trophy")} aria-hidden="true">
        <div className={cx("rod")} />
        <div className={cx("drop")}>
          <div className={cx("banner")}>
          <div className={`${cx("bannerInner")} ${stageFont.variable}`}>
            <span className={cx("bannerYear")}>{season}</span>
            <span className={cx("bannerWord")}>League</span>
            <span className={cx("bannerWord")}>Champion</span>
            <span className={cx("bannerRule")} />
            <span className={cx("bannerTeam")}>Your team</span>
          </div>
          <span className={cx("glint")} />
          </div>
        </div>
        <figcaption className={cx("trophyNote")}>Your name goes here.</figcaption>
      </figure>
    </section>
  );
}
