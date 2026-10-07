"use client";

import { useId, useRef, useState } from "react";
import s from "./appBar.module.css";

export interface MenuLeague {
  id: string;
  name: string;
}

/** One of the current league's actions: a link, or something the page does in place. */
export type MenuAction = { label: string; href: string } | { label: string; onSelect(): void };

/**
 * The league menu (Epic 15): the league you're in, as the app bar's title, opening onto every league
 * you have, this league's actions, and starting a new one. At most those three groups, text rows
 * only, and an action shows only when it applies; the page decides which ones do.
 */
export function LeagueMenu({
  leagues,
  currentId,
  currentName,
  onPick,
  actions = [],
  onNewLeague,
  title,
}: {
  leagues: readonly MenuLeague[];
  currentId: string | null;
  currentName: string;
  onPick(id: string): void;
  actions?: readonly MenuAction[];
  onNewLeague?(): void;
  /** A longer description of the league, for the trigger's tooltip. */
  title?: string;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Picking a row closes the menu first, so a dialog it opens isn't stacked under it.
  const pick = (action: () => void) => () => {
    menu.current?.hidePopover();
    action();
  };

  return (
    <>
      <button type="button" className={s.leagueBtn} popoverTarget={id} aria-haspopup="menu" aria-expanded={open} title={title}>
        <span className={s.leagueName}>{currentName}</span>
        <svg viewBox="0 0 16 16" aria-hidden focusable="false">
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div ref={menu} id={id} popover="auto" role="menu" aria-label="Leagues" className={s.menu} onToggle={(e) => setOpen(e.newState === "open")}>
        <div className={s.group} role="group" aria-label="Your leagues">
          {leagues.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitemradio"
              aria-checked={l.id === currentId}
              className={s.item}
              onClick={pick(() => {
                if (l.id !== currentId) onPick(l.id);
              })}
            >
              <span>{l.name}</span>
              {l.id === currentId && <Check />}
            </button>
          ))}
        </div>
        {actions.length > 0 && (
          <div className={s.group} role="group" aria-label="This league">
            {actions.map((a) =>
              "href" in a ? (
                <a key={a.label} role="menuitem" className={s.item} href={a.href}>
                  <span>{a.label}</span>
                </a>
              ) : (
                <button key={a.label} type="button" role="menuitem" className={s.item} onClick={pick(a.onSelect)}>
                  <span>{a.label}</span>
                </button>
              ),
            )}
          </div>
        )}
        {onNewLeague && (
          <div className={s.group}>
            <button type="button" role="menuitem" className={`${s.item} ${s.muted}`} onClick={pick(onNewLeague)}>
              <span>+ New league</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function Check() {
  return (
    <svg className={s.check} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
