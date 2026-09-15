"use client";

import { useCallback } from "react";
import { buildRoster, conflicts } from "@/lib/draft/roster";
import { draftReducer } from "@/lib/draft/state";
import { isMyPick } from "@/lib/draft/snake";
import { useDraft } from "./DraftProvider";
import { useModel } from "./DraftModel";
import { useConfirm, useToast } from "./Feedback";
import { useSim } from "./Simulator";

/** Briefly highlights every rendered card and roster row for a player (the prototype's flashCards). */
function flash(playerId: string) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll<HTMLElement>(`[data-player-id="${CSS.escape(playerId)}"]`).forEach((el) =>
    el.animate([{ background: "color-mix(in srgb, var(--color-warn) 55%, transparent)" }, { background: "transparent" }], {
      duration: 1100,
      easing: "ease-out",
    }),
  );
}

export type ClickIntent = "auto" | "mine" | "other";

/** Pick-logging behavior shared by every card, chip, and search result. Ported from the prototype's draft()/untake(). */
export function useDraftActions() {
  const draftCtx = useDraft();
  const model = useModel();
  const toast = useToast();
  const confirm = useConfirm();
  const sim = useSim();

  /** Logs a pick for an available player, or moves a taken player between rosters. */
  const draft = useCallback(
    async (playerId: string, mine: boolean) => {
      const p = model.player(playerId);
      if (!p) return;
      const tk = model.taken.get(playerId);
      /** After adding to my roster: warn (and flash) if it created a bye conflict, else confirm the pick. */
      const afterMine = (picks: typeof draftCtx.state.picks, okMessage: string) => {
        const clash = conflicts(buildRoster(picks, model.player, model.league.roster).slots).get(playerId);
        if (!clash) return toast(okMessage);
        flash(playerId);
        toast(`⚠️ Week ${p.bye} now has ${clash.n} starters out: ${p.name} + ${clash.who.join(", ")}`);
      };

      if (tk) {
        if (mine === tk.mine) return;
        draftCtx.setMine(playerId, mine);
        const next = draftReducer(draftCtx.state, { type: "setMine", playerId, mine });
        if (mine) afterMine(next.picks, `${p.name} moved to your roster`);
        else toast(`${p.name} moved to another team`);
        return;
      }
      if (model.done) {
        toast("Draft is complete");
        return;
      }
      if (!mine && isMyPick(model.current, model.league)) {
        const ok = await confirm({
          message: `Pick ${model.current} is yours. Log ${p.name} as drafted by another team anyway?`,
          confirmLabel: "Another team",
        });
        if (!ok) return;
      }
      draftCtx.draft(playerId, mine);
      const next = draftReducer(draftCtx.state, { type: "draft", playerId, mine, totalPicks: model.total });
      if (mine) afterMine(next.picks, `Pick ${next.picks.length}: ${p.name} is yours`);
      else toast(`Pick ${next.picks.length}: ${p.name} to another team`);
    },
    [draftCtx, model, toast, confirm],
  );

  const untake = useCallback(
    (playerId: string) => {
      if (!model.taken.has(playerId)) return;
      draftCtx.untake(playerId);
      toast(`${model.player(playerId)?.name ?? "Player"} put back on the board`);
    },
    [draftCtx, model, toast],
  );

  /** Plain click = whoever is on the clock; Cmd/Ctrl = another team; Shift = mine. */
  const intentFrom = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): ClickIntent =>
    e.metaKey || e.ctrlKey ? "other" : e.shiftKey ? "mine" : "auto";

  const draftWithIntent = useCallback(
    (playerId: string, intent: ClickIntent) =>
      draft(playerId, intent === "mine" ? true : intent === "other" ? false : model.onClock),
    [draft, model.onClock],
  );

  const undo = useCallback(() => {
    sim.stop();
    const last = draftCtx.state.picks.at(-1);
    if (!last) {
      toast("Nothing to undo");
      return;
    }
    draftCtx.undo();
    toast(`Undid pick ${draftCtx.state.picks.length}: ${model.player(last.playerId)?.name ?? ""}`);
  }, [draftCtx, model, toast, sim]);

  const reset = useCallback(async () => {
    sim.stop();
    const ok = await confirm({
      message: "Reset the entire draft? This clears every pick and your roster.",
      confirmLabel: "Reset draft",
      danger: true,
    });
    if (!ok) return;
    draftCtx.reset();
    toast("Draft reset");
  }, [draftCtx, confirm, toast, sim]);

  return { draft, untake, draftWithIntent, intentFrom, undo, reset };
}
