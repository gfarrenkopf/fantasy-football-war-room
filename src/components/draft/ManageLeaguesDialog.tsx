"use client";

import { useEffect } from "react";
import type { LeagueRecord } from "@/lib/storage";
import { cx, s } from "./cx";
import { useConfirm, useToast } from "./Feedback";
import { useLeague } from "./LeagueProvider";
import { useShell } from "./SeasonLinks";

/**
 * Every league the user has, each with a Delete (APE-324), so a list grown long from testing can be
 * cleared without opening each league's settings in turn. A league that follows ESPN can go too:
 * its season page stops updating, and the league on ESPN isn't touched. Mounted above the draft's
 * key (LeagueGate), so deleting the open league, or picking a name to open it, switches leagues
 * without closing the list.
 */
export function ManageLeaguesDialog({ onClose }: { onClose(): void }) {
  const { leagues, active, switchLeague, deleteLeague } = useLeague();
  const shell = useShell();
  const confirm = useConfirm();
  const toast = useToast();
  const linked = (id: string) => shell.leagues.some((l) => l.id === id && l.linked);

  // Bubbling, so an open confirm (which handles Escape first) closes alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const remove = async (league: LeagueRecord) => {
    const espn = linked(league.id) ? " Draft Room stops following it on ESPN; your league on ESPN isn't touched." : "";
    const ok = await confirm({
      message: `Delete ${league.name} and its draft?${espn} This can't be undone.`,
      confirmLabel: "Delete league",
      danger: true,
    });
    if (!ok) return;
    deleteLeague(league.id);
    toast(`${league.name} deleted`);
    // With none left, first-run setup takes over.
    if (leagues.length === 1) onClose();
  };

  return (
    <>
      <div className={s.scrim} onClick={onClose} />
      <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="manage-leagues-title">
        <h3 id="manage-leagues-title">Manage leagues</h3>
        <ul className={s.manageLeagues}>
          {leagues.map((l) => (
            <li key={l.id}>
              <button type="button" className={s.mlName} aria-current={l.id === active?.id} onClick={() => l.id !== active?.id && switchLeague(l.id)}>
                <b>{l.name}</b>
                {(l.id === active?.id || linked(l.id)) && (
                  <span className={s.mlNote}>{[l.id === active?.id && "Open now", linked(l.id) && "Follows ESPN"].filter(Boolean).join(" · ")}</span>
                )}
              </button>
              <button className={cx("btn", "danger")} onClick={() => void remove(l)} aria-label={`Delete ${l.name}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className={s.dialogActions}>
          <button className={cx("btn", "primary")} onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
