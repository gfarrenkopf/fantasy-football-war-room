"use client";

import { useEffect, useRef, useState } from "react";
import { POSITIONS, type Position } from "@/lib/draft/types";
import type { SeasonView } from "@/lib/season/view";
import type { Pickup, Rostered } from "@/lib/season/waivers";
import { Search } from "./Icons";
import { RosteredRow, WeeklyGain, WireRow } from "./WireRow";
import s from "./season.module.css";

/** How long typing pauses before the search goes to ESPN. */
const DEBOUNCE_MS = 300;

type Page = { players: Pickup[]; rostered: Rostered[]; more: boolean };
/** What a search read: its players so far, or why it couldn't. */
type Load = { kind: "ok"; players: Pickup[]; rostered: Rostered[]; more: boolean; adding: boolean } | { kind: "failed"; error: string };

async function fetchPage(leagueId: string, { q, pos, offset }: { q: string; pos: Position | null; offset: number }, signal: AbortSignal): Promise<Page | { error: string }> {
  const params = new URLSearchParams();
  if (q.trim().length >= 2) params.set("q", q.trim());
  if (pos) params.set("pos", pos);
  if (offset) params.set("offset", String(offset));
  const query = params.size ? `?${params}` : "";
  const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/season/players${query}`, { signal }).catch((err: unknown) => (signal.aborted ? Promise.reject(err) : null));
  const body = (await res?.json().catch(() => null)) as { players?: Pickup[]; rostered?: Rostered[]; more?: boolean; error?: string } | null;
  if (res?.ok && body?.players) return { players: body.players, rostered: body.rostered ?? [], more: body.more ?? false };
  return { error: body?.error ?? "Can't reach Draft Room right now. Try again in a moment." };
}

/** How widely a row's player is rostered across ESPN, for the list's order; unknown sorts last. */
const owned = (row: { kind: "free"; pickup: Pickup } | { kind: "team"; rostered: Rostered }) => (row.kind === "free" ? row.pickup.player : row.rostered.player).ownership?.owned ?? -1;

const LABEL: Record<Position, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DST: "D/ST" };

/**
 * Every available player in the league, not just the pickups worth a claim (APE-410): searched by
 * name and narrowed to a position, most-rostered first, a page at a time. Each is valued for the
 * user's best lineup and added or claimed in place, as a pickup is. A name search also shows the
 * league's rostered players it matches, with whose team they're on and a trade (APE-413).
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
  onTrade,
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
  onTrade: (partnerId: number, playerId: number) => void;
}) {
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<Position | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([leagueId, q.trim().length >= 2 ? q.trim().toLowerCase() : "", pos, reread, retry]);
  /**
   * Every search's answer this visit, so going back to one shows it at once. An add changes `reread`,
   * and with it every key, so nothing read before the add is shown after it.
   */
  const [answers, setAnswers] = useState<ReadonlyMap<string, Load>>(new Map());
  /** The search whose answer is on screen: while the next one reads, the last stays up, dimmed. */
  const [shown, setShown] = useState<string | null>(null);
  const known = useRef(new Set<string>());
  const loading = !answers.has(key);
  const load = answers.get(key) ?? (shown ? answers.get(shown) : undefined);
  const players = load?.kind === "ok" ? load.players : [];
  /** Free agents and rostered players in one list, most-rostered across ESPN first, as ESPN sorts the pool. */
  const rows: ({ kind: "free"; pickup: Pickup } | { kind: "team"; rostered: Rostered })[] = [
    ...players.map((pickup) => ({ kind: "free" as const, pickup })),
    ...(load?.kind === "ok" ? load.rostered : []).map((rostered) => ({ kind: "team" as const, rostered })),
  ].sort((a, b) => owned(b) - owned(a));
  const searching = q.trim().length >= 2;
  const paging = useRef<AbortController | null>(null);

  const answer = (at: string, next: Load) => {
    if (next.kind === "ok") known.current.add(at);
    setAnswers((was) => new Map(was).set(at, next));
    setShown(at);
  };

  // The first page, whenever the search changes: after a pause while typing, at once otherwise, and
  // not at all for a search already answered.
  useEffect(() => {
    paging.current?.abort();
    if (known.current.has(key)) return;
    const controller = new AbortController();
    const [, name, position] = JSON.parse(key) as [string, string, Position | null];
    const timer = setTimeout(
      () => {
        void fetchPage(leagueId, { q: name, pos: position, offset: 0 }, controller.signal)
          .then((page) => !controller.signal.aborted && answer(key, "error" in page ? { kind: "failed", error: page.error } : { kind: "ok", ...page, adding: false }))
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
    const at = key;
    const now = answers.get(at);
    if (now?.kind !== "ok") return;
    const controller = new AbortController();
    paging.current = controller;
    answer(at, { ...now, adding: true });
    const page = await fetchPage(leagueId, { q, pos, offset: now.players.length }, controller.signal).catch(() => null);
    if (controller.signal.aborted) return;
    const had = new Set(now.players.map((p) => p.player.playerId));
    answer(at, !page || "error" in page ? { ...now, adding: false } : { ...now, players: [...now.players, ...page.players.filter((p) => !had.has(p.player.playerId))], more: page.more, adding: false });
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
      ) : rows.length ? (
        <ol className={s.bench} aria-busy={loading} data-busy={loading || undefined}>
          {rows.map((row) =>
            row.kind === "team" ? (
              <RosteredRow key={`team-${row.rostered.player.playerId}`} rostered={row.rostered} onTrade={onTrade} />
            ) : (
              <WireRow
                key={row.pickup.player.playerId}
                view={view}
                leagueId={leagueId}
                pickup={row.pickup}
                names={names}
                writeConsented={writeConsented}
                acting={acting}
                gain={<WeeklyGain pickup={row.pickup} />}
                onAct={onAct}
                onDone={onDone}
              />
            ),
          )}
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
