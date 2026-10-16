"use client";

import { useEffect, useRef, useState } from "react";
import { POSITIONS, type Position } from "@/lib/draft/types";
import type { SeasonView } from "@/lib/season/view";
import type { Pickup } from "@/lib/season/waivers";
import { Search } from "./Icons";
import { WeeklyGain, WireRow } from "./WireRow";
import s from "./season.module.css";

/** How long typing pauses before the search goes to ESPN. */
const DEBOUNCE_MS = 300;

type Page = { players: Pickup[]; more: boolean };
/** What the list last read, and for which search: while the search has moved on, it's loading. */
type Load = { key: string } & ({ kind: "ok"; players: Pickup[]; more: boolean; adding: boolean } | { kind: "failed"; error: string });

async function fetchPage(leagueId: string, { q, pos, offset }: { q: string; pos: Position | null; offset: number }, signal: AbortSignal): Promise<Page | { error: string }> {
  const params = new URLSearchParams();
  if (q.trim().length >= 2) params.set("q", q.trim());
  if (pos) params.set("pos", pos);
  if (offset) params.set("offset", String(offset));
  const query = params.size ? `?${params}` : "";
  const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/players${query}`, { signal }).catch((err: unknown) => (signal.aborted ? Promise.reject(err) : null));
  const body = (await res?.json().catch(() => null)) as { players?: Pickup[]; more?: boolean; error?: string } | null;
  if (res?.ok && body?.players) return { players: body.players, more: body.more ?? false };
  return { error: body?.error ?? "Can't reach Draft Room right now. Try again in a moment." };
}

const LABEL: Record<Position, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DST: "D/ST" };

/**
 * Every available player in the league, not just the pickups worth a claim (APE-410): searched by
 * name and narrowed to a position, most-rostered first, a page at a time. Each is valued for the
 * user's best lineup and added or claimed in place, as a pickup is.
 */
export function FreeAgentSearch({
  view,
  leagueId,
  names,
  writeConsented,
  acting,
  reread,
  onAct,
  onDone,
}: {
  view: SeasonView;
  leagueId: string;
  names: ReadonlyMap<number, string>;
  writeConsented: boolean;
  acting: number | null;
  /** Bumped after an add lands, which empties the server's pool cache, so the list reads ESPN again. */
  reread: number;
  onAct: (playerId: number | null) => void;
  onDone: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<Position | null>(null);
  const [load, setLoad] = useState<Load | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([leagueId, q.trim().length >= 2 ? q.trim().toLowerCase() : "", pos, reread, retry]);
  const loading = load?.key !== key;
  /** The last list read stays up, dimmed, while the next search reads. */
  const players = load?.kind === "ok" ? load.players : [];
  const searching = q.trim().length >= 2;
  const paging = useRef<AbortController | null>(null);

  // The first page, whenever the search changes: after a pause while typing, at once otherwise.
  useEffect(() => {
    paging.current?.abort();
    const controller = new AbortController();
    const [, name, position] = JSON.parse(key) as [string, string, Position | null];
    const timer = setTimeout(
      () => {
        void fetchPage(leagueId, { q: name, pos: position, offset: 0 }, controller.signal)
          .then((page) => !controller.signal.aborted && setLoad("error" in page ? { key, kind: "failed", error: page.error } : { key, kind: "ok", ...page, adding: false }))
          .catch(() => {});
      },
      name ? DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, leagueId]);

  async function more() {
    if (load?.kind !== "ok" || loading) return;
    const controller = new AbortController();
    paging.current = controller;
    setLoad({ ...load, adding: true });
    const page = await fetchPage(leagueId, { q, pos, offset: load.players.length }, controller.signal).catch(() => null);
    if (!page || controller.signal.aborted) return;
    const had = new Set(load.players.map((p) => p.player.playerId));
    setLoad("error" in page ? { ...load, adding: false } : { ...load, players: [...load.players, ...page.players.filter((p) => !had.has(p.player.playerId))], more: page.more, adding: false });
  }

  const where = `${pos ? LABEL[pos] : "player"}${searching ? ` matching “${q.trim()}”` : ""}`;

  return (
    <section className={`${s.panel} ${s.faSearch}`} aria-labelledby="free-agents-title">
      <div className={s.panelHead}>
        <h2 id="free-agents-title" className={s.panelTitle}>
          Free agents
        </h2>
        <span className={s.panelNote}>Most rostered first</span>
      </div>

      <div className={s.faTools} role="search">
        <label className={s.faField}>
          <Search className={s.faIcon} />
          <span className="sr-only">Search available players by name</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" autoComplete="off" spellCheck={false} enterKeyHint="search" />
        </label>
        <div className={s.faPositions} role="radiogroup" aria-label="Position">
          {[null, ...POSITIONS].map((p) => (
            <button key={p ?? "all"} type="button" role="radio" aria-checked={pos === p} className={s.faPos} data-pos={p ?? undefined} onClick={() => setPos(p)}>
              {p ? LABEL[p] : "All"}
            </button>
          ))}
        </div>
      </div>

      {!loading && load?.kind === "failed" ? (
        <div className={`${s.note} ${s.waiverProblem}`} role="alert">
          <p className={s.fine}>{load.error}</p>
          <button type="button" className={s.button} onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : players.length ? (
        <ol className={s.bench} aria-busy={loading} data-busy={loading || undefined}>
          {players.map((pickup) => (
            <WireRow
              key={pickup.player.playerId}
              view={view}
              leagueId={leagueId}
              pickup={pickup}
              names={names}
              writeConsented={writeConsented}
              acting={acting}
              gain={<WeeklyGain pickup={pickup} />}
              onAct={onAct}
              onDone={onDone}
            />
          ))}
        </ol>
      ) : loading ? (
        <p className={`${s.note} ${s.fine}`} role="status">
          Reading ESPN&apos;s player pool…
        </p>
      ) : (
        <p className={`${s.note} ${s.fine}`} role="status">
          No available {where}. {searching ? "ESPN matches the start of a first or last name." : "Every one is on a roster."}
        </p>
      )}

      {!loading && load?.kind === "ok" && load.more && (
        <div className={s.faMore}>
          <button type="button" className={s.button} onClick={() => void more()} disabled={load.adding}>
            {load.adding ? "Loading…" : "Show more"}
          </button>
        </div>
      )}
    </section>
  );
}
