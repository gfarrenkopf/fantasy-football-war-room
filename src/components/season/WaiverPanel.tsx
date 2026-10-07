"use client";

import { useEffect, useState } from "react";
import type { SeasonView } from "@/lib/season/view";
import type { Pickup } from "@/lib/season/waivers";
import { AcquireReview } from "./AcquireReview";
import { ClaimList } from "./ClaimList";
import { External, Refresh } from "./Icons";
import { PlayerLine, signed } from "./parts";
import s from "./season.module.css";

type Load = { kind: "loading" } | { kind: "ok"; pickups: Pickup[]; considered: number } | { kind: "failed"; error: string };

const clears = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

async function fetchWaivers(leagueId: string, refresh: boolean): Promise<Load> {
  const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/waivers${refresh ? "?refresh=1" : ""}`).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { pickups?: Pickup[]; considered?: number; error?: string } | null;
  if (res?.ok && body?.pickups) return { kind: "ok", pickups: body.pickups, considered: body.considered ?? 0 };
  return { kind: "failed", error: body?.error ?? "Can't reach Draft Room right now. Try again in a moment." };
}

/** "Waiver priority 4 of 12", or FAAB left in a league that bids. */
function waiverNote(view: SeasonView): string | null {
  const { rank, budget, left } = view.waiver;
  if (budget !== null && left !== null) return `$${left} of $${budget} FAAB left`;
  return rank ? `Waiver priority ${rank} of ${view.teams.length}` : null;
}

/**
 * The waiver wire (APE-212): available players who'd improve the user's best lineup for the rest of
 * the season, each with who to drop. Read from ESPN when the tab opens, since the page's own read
 * doesn't carry the pool. A free agent can be added from here, with a drop (13.3), and a player on
 * waivers claimed, with the user's pending claims listed to cancel (13.4). FAAB leagues claim on ESPN.
 */
export function WaiverPanel({ view, leagueId, writeConsented }: { view: SeasonView; leagueId: string; writeConsented: boolean }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  /** The pickup being reviewed, by player id. */
  const [acting, setActing] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const names = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
  const note = waiverNote(view);

  useEffect(() => {
    let live = true;
    void fetchWaivers(leagueId, false).then((next) => live && setLoad(next));
    return () => {
      live = false;
    };
  }, [leagueId]);

  const read = async (refresh: boolean) => {
    setLoad({ kind: "loading" });
    setLoad(await fetchWaivers(leagueId, refresh));
  };

  const espn = `https://fantasy.espn.com/football/players/add?leagueId=${view.espnLeagueId}`;

  return (
    <section className={`${s.panel} ${s.waivers}`} aria-labelledby="waivers-title">
      <div className={s.panelHead}>
        <h2 id="waivers-title" className={s.panelTitle}>
          Pickups worth a claim
        </h2>
        {note && <span className={s.panelNote}>{note}</span>}
      </div>

      <ClaimList view={view} leagueId={leagueId} agreed={writeConsented} onNotice={setNotice} />

      {notice && (
        <p className={`${s.note} ${s.fine}`} role="status">
          {notice}
        </p>
      )}

      {load.kind === "loading" && (
        <p className={`${s.note} ${s.fine}`} role="status">
          Reading ESPN&apos;s waiver wire…
        </p>
      )}

      {load.kind === "failed" && (
        <div className={`${s.note} ${s.waiverProblem}`} role="alert">
          <p className={s.fine}>{load.error}</p>
          <button type="button" className={s.button} onClick={() => read(true)}>
            Try again
          </button>
        </div>
      )}

      {load.kind === "ok" &&
        (load.pickups.length ? (
          <ol className={s.bench}>
            {load.pickups.map(({ player, perWeek, delta, drop }, i) => (
              <li key={player.playerId} className={s.benchRow}>
                <span className={s.pickupWho}>
                  <PlayerLine player={player} value="none" ownership live />
                  <span className={s.pickupStatus} data-status={player.status}>
                    {player.status === "WAIVERS" ? (
                      <>
                        On waivers
                        {player.waiverClears && (
                          <>
                            {" "}
                            · clears <span suppressHydrationWarning>{clears(player.waiverClears)}</span>
                          </>
                        )}
                      </>
                    ) : (
                      "Free agent: add now"
                    )}
                  </span>
                </span>
                <span className="text-right">
                  <span className={`${s.pickupGain} tabular-nums`}>
                    {signed(perWeek)}
                    <span className={s.gainUnit}> a week</span>
                  </span>
                  <span className={`${s.benchStatus} block`}>
                    <span className="tabular-nums">{signed(delta)}</span> rest of season
                  </span>
                  {drop !== null && <span className={`${s.benchNote} block`}>Drop {names.get(drop) ?? "your weakest player"}</span>}
                  {acting !== player.playerId && (player.status === "FREEAGENT" || view.waiver.budget === null) && (
                    <button
                      type="button"
                      className={`${s.button} ${s.pickupAct}`}
                      onClick={() => {
                        setActing(player.playerId);
                        setNotice(null);
                      }}
                    >
                      {player.status === "WAIVERS" ? "Claim" : "Add"}
                    </button>
                  )}
                </span>
                {acting === player.playerId && (
                  <AcquireReview
                    view={view}
                    leagueId={leagueId}
                    pickup={load.pickups[i]}
                    agreed={writeConsented}
                    onCancel={() => setActing(null)}
                    onDone={(message) => {
                      setActing(null);
                      setNotice(message);
                      void read(true);
                    }}
                  />
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className={`${s.note} ${s.fine}`}>
            None of the {load.considered} most-rostered players on the wire would improve your lineup. Check back after waivers clear.
          </p>
        ))}

      <p className={`${s.fine} ${s.waiverFoot}`}>
        Ranked by what each adds to your best lineup for the rest of the season, from ESPN&apos;s projections. Add a free agent or claim a player on waivers from here.
        {load.kind === "ok" && (
          <>
            {" "}
            <button type="button" className={s.textButton} onClick={() => read(true)}>
              <Refresh /> Re-read
            </button>
          </>
        )}
      </p>
      <a className={s.espnLink} href={espn} target="_blank" rel="noreferrer">
        Open free agents on ESPN <External />
      </a>
    </section>
  );
}

