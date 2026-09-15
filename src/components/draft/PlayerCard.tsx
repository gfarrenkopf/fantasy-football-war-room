"use client";

import { memo } from "react";
import { valueTag, valueTagLabel } from "@/lib/draft/value";
import type { Player } from "@/lib/draft/types";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { useDraftActions } from "./useDraftActions";

export const posLabel = (pos: Player["pos"]) => (pos === "DST" ? "D/ST" : pos);

interface PlayerCardProps {
  player: Player;
  /** Rank badge text; defaults to position rank. */
  rank?: string | number;
  /** Search match highlight. */
  hit?: boolean;
  /** Extra CSS-module class names (e.g. "avoid", "fell"). */
  extra?: string[];
}

/**
 * A player row: rank, name + injury dot, position/team/bye chip, ADP vs consensus, Value/Reach tag,
 * and the ✕ "another team" button. Ported from the prototype's cardHtml() and its click handlers.
 */
export const PlayerCard = memo(function PlayerCard({ player: p, rank, hit, extra = [] }: PlayerCardProps) {
  const model = useModel();
  const { draftWithIntent, intentFrom, untake, draft } = useDraftActions();
  const tk = model.taken.get(p.id);
  const clash = tk ? null : model.byeClashFor(p);
  const tag = valueTag(p, model.league.valueThreshold);
  const adpLabel = model.dataset.adpSource;

  const onClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-other]")) return void draft(p.id, false);
    if (tk) return untake(p.id);
    void draftWithIntent(p.id, intentFrom(e));
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!tk) void draft(p.id, false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const key = e.key.toLowerCase();
    if (key === "enter" || key === " ") {
      e.preventDefault();
      if (tk) untake(p.id);
      else void draftWithIntent(p.id, intentFrom(e));
    } else if (key === "x") {
      e.preventDefault();
      void draft(p.id, false);
    } else if (key === "m") {
      e.preventDefault();
      void draft(p.id, true);
    }
  };

  return (
    <div
      className={cx("card", p.pos, !!tk && "taken", tk?.mine && "mine", !!clash && "byewarn", (clash?.n ?? 0) >= 3 && "byewarn3", hit && "hit", ...extra)}
      data-player-id={p.id}
      role="button"
      tabIndex={0}
      aria-label={`${p.name}, ${posLabel(p.pos)} ${p.team}${tk ? (tk.mine ? ", on your roster" : ", drafted") : ""}`}
      title={`${p.name}${p.note ? ` — ${p.note}` : ""}. Click: log this pick for whoever is on the clock. Cmd/Ctrl-click, right-click or ✕: drafted by another team. Shift-click: yours.`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <div className={s.rk}>{rank ?? p.posRank}</div>
      <div className={s.nm}>
        <div className={s.n}>
          <span className={s.nt}>{p.name}</span>
          {p.note && <span className={s.note} title={p.note} />}
        </div>
        <div className={s.m}>
          <b className={s.pl}>{posLabel(p.pos)}</b>
          {p.team}
          <span
            className={s.bye}
            title={clash ? `Would make ${clash.n} starters out in week ${p.bye} (with ${clash.who.join(", ")})` : undefined}
          >
            Bye {p.bye}
          </span>
        </div>
      </div>
      <div className={s.stats}>
        <div className={s.rr}>
          <span>{adpLabel}</span>
          <b>{p.adp}</b>
          <span>ECR</span>
          <b>{p.consensusRank}</b>
        </div>
        <span className={cx("tag", tag.kind)} title={tag.kind === "na" ? "Value/reach tags are not meaningful for K and D/ST" : undefined}>
          {valueTagLabel(tag)}
        </span>
      </div>
      <button className={s.othBtn} data-other title="Drafted by another team" aria-label={`Mark ${p.name} drafted by another team`} tabIndex={-1}>
        ✕
      </button>
    </div>
  );
});
