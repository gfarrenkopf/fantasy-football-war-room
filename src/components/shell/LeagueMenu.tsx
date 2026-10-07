"use client";

import { useId, useRef, useState } from "react";
import s from "./appBar.module.css";

export interface MenuLeague {
  id: string;
  name: string;
}

/** One of the current league's actions: a link, or something the page does in place. */
export type MenuAction = { label: string; href: string; external?: boolean } | { label: string; onSelect(): void };

/**
 * The league menu (Epic 15): the league you're in, as the app bar's title, opening onto this
 * league's actions (an inset block of places to go), every league you have (a list to pick from),
 * and starting a new one (a button). Each kind of row has its own shape, so the three never blur. At most those three groups, text rows
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
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label="Leagues"
        className={s.menu}
        onToggle={(e) => {
          setOpen(e.newState === "open");
          // A long list opens on the league you're in, not on whichever one sorts first.
          if (e.newState === "open") menu.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
        }}
      >
        {/* Where this league goes: an inset block, each row ending in a chevron. */}
        {actions.length > 0 && (
          <div className={s.here} role="group" aria-label={`${currentName}`}>
            {actions.map((a) =>
              "href" in a ? (
                <a key={a.label} role="menuitem" className={`${s.item} ${s.go}`} href={a.href} {...(a.external ? { target: "_blank", rel: "noreferrer" } : {})}>
                  <span>{a.label}</span>
                  {a.external ? <External /> : <Chevron />}
                </a>
              ) : (
                <button key={a.label} type="button" role="menuitem" className={`${s.item} ${s.go}`} onClick={pick(a.onSelect)}>
                  <span>{a.label}</span>
                  <Chevron />
                </button>
              ),
            )}
          </div>
        )}
        {/* Which league you're in: a plain list, the current one checked. */}
        <div className={s.switchGroup} role="group" aria-labelledby={`${id}-leagues`}>
          <span id={`${id}-leagues`} className={s.groupLabel}>
            Switch league
          </span>
          <div className={s.leagues}>
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
        </div>
        {/* Starting one: set apart as the product's outlined primary. */}
        {onNewLeague && (
          <button type="button" role="menuitem" className={s.create} onClick={pick(onNewLeague)}>
            <svg viewBox="0 0 16 16" aria-hidden focusable="false">
              <path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            New league
          </button>
        )}
      </div>
    </>
  );
}

function Chevron() {
  return (
    <svg className={s.chevron} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Leaves Draft Room: the settings of a league that follows ESPN live on ESPN. */
function External() {
  return (
    <svg className={s.chevron} viewBox="0 0 16 16" aria-label="opens ESPN" role="img" focusable="false">
      <path d="M9.5 3h3.5v3.5M13 3 8 8M11.5 9.5V13H3V4.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check() {
  return (
    <svg className={s.check} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
