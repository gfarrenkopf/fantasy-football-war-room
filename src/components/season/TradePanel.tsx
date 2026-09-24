"use client";

import { useState } from "react";
import type { Position } from "@/lib/draft/types";
import { evaluateTrade, type TeamVerdict } from "@/lib/season/trade";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";

const POS_TEXT: Record<Position, string> = { QB: "text-qb", RB: "text-rb", WR: "text-wr", TE: "text-te", K: "text-k", DST: "text-dst" };
const SLOT_LABEL: Record<string, string> = { SUPERFLEX: "OP", DST: "D/ST" };

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
const byRos = (a: ViewPlayer, b: ViewPlayer) => b.ros - a.ros;

/**
 * Build a trade and see what it does to both starting lineups for the rest of the season (10.6).
 * Nothing here touches ESPN: it's a what-if, recomputed as players are picked.
 */
export function TradePanel({ view }: { view: SeasonView }) {
  const others = view.teams.filter((t) => t.id !== view.myTeamId);
  const [partnerId, setPartnerId] = useState(others[0]?.id ?? 0);
  const [gives, setGives] = useState<number[]>([]);
  const [gets, setGets] = useState<number[]>([]);
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  const partner = others.find((t) => t.id === partnerId);

  // The React Compiler memoizes this; it's a few milliseconds even for a 16-team league.
  const verdict = partner ? evaluateTrade(view.teams, view, { teamA: view.myTeamId, gives, teamB: partner.id, gets }) : null;

  if (!mine || !partner) return <p className="rounded-card border border-line bg-panel p-4 text-sm">There&apos;s no one in this league to trade with.</p>;

  const names = new Map(view.teams.flatMap((t) => t.roster.map((p) => [p.playerId, p.name] as const)));
  const toggle = (list: number[], set: (next: number[]) => void, id: number) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <section className="space-y-3" aria-labelledby="trade-title">
      <div className="rounded-card border border-line bg-panel p-4 space-y-3">
        <h2 id="trade-title" className="font-semibold">
          Check a trade
        </h2>
        <label className="block text-sm">
          <span className="text-muted">Trade with</span>
          <select
            className="mt-1 block w-full rounded-card border border-line2 bg-panel2 px-2 py-2 text-base"
            value={partner.id}
            onChange={(e) => {
              setPartnerId(Number(e.target.value));
              setGets([]);
            }}
          >
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {verdict ? (
          <Verdict you={verdict.a} them={verdict.b} partnerName={partner.name} weeks={verdict.weeks} names={names} />
        ) : (
          <p className="text-sm text-muted">Pick who you&apos;d send and who you&apos;d get. The verdict compares both starting lineups for the rest of the season.</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <RosterPicker title="You send" roster={mine.roster} picked={gives} onToggle={(id) => toggle(gives, setGives, id)} />
        <RosterPicker title={`You get from ${partner.name}`} roster={partner.roster} picked={gets} onToggle={(id) => toggle(gets, setGets, id)} />
      </div>
    </section>
  );
}

function Verdict({ you, them, partnerName, weeks, names }: { you: TeamVerdict; them: TeamVerdict; partnerName: string; weeks: number; names: Map<number, string> }) {
  const headline =
    you.delta > 0.05 && them.delta > 0.05
      ? "Helps both of you"
      : you.delta > 0.05
        ? "Good for you"
        : you.delta < -0.05
          ? "Bad for you"
          : "Makes no real difference to you";
  return (
    <div className="space-y-2" role="status">
      <p className="text-lg font-semibold">{headline}</p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-card bg-panel2 p-2">
          <dt className="text-muted">You</dt>
          <dd className={`tabular-nums font-semibold ${you.delta >= 0 ? "text-value-ink" : "text-reach-ink"}`}>
            {signed(you.perWeek)} a week
          </dd>
          <dd className="text-xs text-muted tabular-nums">
            {signed(you.delta)} over {weeks} weeks
          </dd>
        </div>
        <div className="rounded-card bg-panel2 p-2">
          <dt className="truncate text-muted">{partnerName}</dt>
          <dd className={`tabular-nums font-semibold ${them.delta >= 0 ? "text-value-ink" : "text-reach-ink"}`}>
            {signed(them.perWeek)} a week
          </dd>
          <dd className="text-xs text-muted tabular-nums">
            {signed(them.delta)} over {weeks} weeks
          </dd>
        </div>
      </dl>
      <ul className="space-y-0.5 text-sm text-muted">
        {you.bySlot
          .filter((s) => Math.abs(s.after - s.before) >= 0.05)
          .map((s) => (
            <li key={s.key}>
              Your {SLOT_LABEL[s.key] ?? s.key}: <span className="tabular-nums">{signed(s.after - s.before)}</span> a week
            </li>
          ))}
      </ul>
      {[...you.drops.map((id) => `You'd have to drop ${names.get(id)} to make room.`), ...them.drops.map((id) => `${partnerName} would have to drop ${names.get(id)}.`)].map((line) => (
        <p key={line} className="text-xs text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

function RosterPicker({ title, roster, picked, onToggle }: { title: string; roster: ViewPlayer[]; picked: number[]; onToggle: (id: number) => void }) {
  return (
    <fieldset className="rounded-card border border-line bg-panel">
      <legend className="sr-only">{title}</legend>
      <p className="px-4 pt-3 text-xs uppercase tracking-wider text-muted" aria-hidden>
        {title}
      </p>
      <ul>
        {[...roster].sort(byRos).map((p) => (
          <li key={p.playerId} className="border-b border-row-line last:border-0">
            <label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-hover">
              <input type="checkbox" checked={picked.includes(p.playerId)} onChange={() => onToggle(p.playerId)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{p.name}</span>
                <span className="block text-xs text-muted">
                  <span className={POS_TEXT[p.pos]}>{p.pos === "DST" ? "D/ST" : p.pos}</span> · {p.team ?? "FA"}
                </span>
              </span>
              <span className="text-right text-xs tabular-nums text-muted">
                <span className="block text-sm text-text">{p.ros.toFixed(0)}</span>rest of season
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
