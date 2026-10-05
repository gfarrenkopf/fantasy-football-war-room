"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { stage } from "@/components/draft/stageFont";
import type { ProjectionAccuracy } from "@/lib/season/accuracy";
import { weekRecap } from "@/lib/season/recap";
import type { SeasonView } from "@/lib/season/view";
import { hasPlayedMoment, markMomentPlayed, momentKey } from "@/lib/storage/moments";
import { pts, signed } from "./parts";
import s from "./season.module.css";
import { saveWinCard } from "./winCard";
import { WinNight } from "./WinNight";

/**
 * Whether this week's win night had already played when the page opened. Read once per key and
 * kept, so marking it played as it starts doesn't stop the show. The server, which can't know,
 * says it has, so nothing plays before the browser decides.
 */
const firstLook = new Map<string, boolean>();
const playedAtOpen = (key: string) => {
  if (!firstLook.has(key)) firstLook.set(key, hasPlayedMoment(key));
  return firstLook.get(key)!;
};
const noSubscribe = () => () => {};

/**
 * Weeks whose win night has started in this page visit. Switching to Trades or Waivers and back
 * remounts the panel, and the first look above still says "not played", so this is what keeps the
 * show from opening again; only "Watch it again" replays it.
 */
const startedThisVisit = new Set<string>();

/**
 * The week's result once the matchup is decided (APE-230). A win opens win night (WinNight.tsx)
 * the first time the page is opened on a device, and leaves this panel behind: the result in the
 * stage face on a green wash, the final, the star, and the show to watch again or the win card to
 * save. A loss is a quiet grey panel with no motion: the score, the margin, and one bright spot.
 */
export function MatchupMoment({ leagueId, view, accuracy }: { leagueId: string; view: SeasonView; accuracy: ProjectionAccuracy | null }) {
  const recap = weekRecap(view, accuracy)!;
  const key = momentKey(leagueId, view.season, view.currentWeek);
  const played = useSyncExternalStore(
    noSubscribe,
    () => playedAtOpen(key),
    () => true,
  );
  // Decided once per mount: the first mount of this visit may open the show, a remount never does.
  const [first] = useState(() => !startedThisVisit.has(key));
  const [dismissed, setDismissed] = useState(false);
  const [replay, setReplay] = useState(false);
  const [saving, setSaving] = useState<"idle" | "drawing" | "saved" | "failed">("idle");
  const win = recap.result === "win";
  const open = win && ((!played && first && !dismissed) || replay);

  // Marked as it starts, not as it ends: a reload or a tab switch mid-show doesn't run it again.
  useEffect(() => {
    if (played) return;
    markMomentPlayed(key);
    startedThisVisit.add(key);
  }, [key, played]);

  const keep = async () => {
    if (saving === "drawing") return;
    setSaving("drawing");
    const how = await saveWinCard(recap, view.name).catch(() => "failed" as const);
    setSaving(how === "failed" ? "failed" : how === "cancelled" ? "idle" : "saved");
  };

  const star = recap.star;
  return (
    <>
      <section className={`${s.panel} ${s.moment} ${stage.variable}`} data-result={recap.result} aria-labelledby="moment-title">
        <p className={s.momentWeek}>Week {view.currentWeek} · Final</p>
        <h2 id="moment-title" className={s.momentTitle}>
          {win ? "You won" : recap.result === "loss" ? "Not this week" : "A dead heat"}
        </h2>
        <p className={s.momentScore}>
          <b className="tabular-nums">{pts(recap.me)}</b>
          <span className={s.momentDash}>–</span>
          <span className="tabular-nums">{pts(recap.them)}</span>
        </p>
        <p className={s.momentLine}>
          {win ? (
            <>
              Beat {recap.opponent} by <b className="tabular-nums">{pts(recap.margin)}</b>.
            </>
          ) : recap.result === "loss" ? (
            <>
              {recap.opponent} took it by <b className="tabular-nums">{pts(recap.margin)}</b>. Every contender drops one; the season is longer than a Sunday.
            </>
          ) : (
            <>Level with {recap.opponent}, to the tenth of a point.</>
          )}
        </p>
        {star && (
          <p className={s.momentStar}>
            {recap.result === "loss" ? "Bright spot: " : "Star of the week: "}
            <b>{star.player.name}</b> scored <b className="tabular-nums">{pts(star.player.points)}</b>
            {star.beat ? (
              <>
                , <span className={s.momentGain}>{signed(star.player.points - star.player.projected)}</span> over ESPN&apos;s call.
              </>
            ) : (
              "."
            )}
          </p>
        )}
        {win && (
          <div className={s.momentActions}>
            <button type="button" className={`${s.button} ${s.momentReplay}`} onClick={() => setReplay(true)}>
              Watch it again
            </button>
            <button type="button" className={`${s.button} ${s.buttonGhost}`} onClick={() => void keep()} disabled={saving === "drawing"}>
              {saving === "drawing" ? "Drawing…" : saving === "saved" ? "Win card saved" : saving === "failed" ? "Couldn't save. Try again" : "Save win card"}
            </button>
          </div>
        )}
        <p className={s.momentNext}>Next week&apos;s lineup tools are back Tuesday morning.</p>
      </section>
      {open && (
        <WinNight
          recap={recap}
          league={view.name}
          onDone={() => {
            setDismissed(true);
            setReplay(false);
          }}
        />
      )}
    </>
  );
}
