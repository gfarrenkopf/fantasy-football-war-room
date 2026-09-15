import { roundOf, slotOf } from "../snake";
import type { CpuStyle, DraftPick } from "../types";
import type { SimContext } from "./context";
import { bestOnBoard, cpuPick, type Counts } from "./cpu";
import type { Rng } from "./rng";
import { HOMER_TEAMS } from "./styles";

export interface SimulateOptions {
  /** Make the user's picks too (needs-adjusted best available). Otherwise stop at the user's next pick. */
  autoMe: boolean;
  rng: Rng;
}

/** Index into a room for a CPU draft slot. A room lists every other team's style in slot order, skipping mySlot. */
export const roomIndex = (slot: number, mySlot: number): number => (slot < mySlot ? slot - 1 : slot - 2);

/** Draft slot of room entry `i` (the inverse of roomIndex). */
export const slotForRoomIndex = (i: number, mySlot: number): number => (i + 1 < mySlot ? i + 1 : i + 2);

/** Each slot's position counts from the picks made so far (by snake slot, like the prototype). */
export function slotCounts(picks: DraftPick[], ctx: SimContext): Counts[] {
  const counts: Counts[] = Array.from({ length: ctx.league.teams + 1 }, () => ({}));
  picks.forEach((pick, i) => {
    const p = ctx.byId.get(pick.playerId);
    if (!p) return;
    const c = counts[slotOf(i + 1, ctx.league.teams)];
    c[p.pos] = (c[p.pos] ?? 0) + 1;
  });
  return counts;
}

/** The user's pick when the simulator drafts for them: the top needs-adjusted player on the board. */
export function autoPickForMe(taken: Set<string>, counts: Counts, n: number, ctx: SimContext) {
  return bestOnBoard(taken, counts, roundOf(n, ctx.league.teams), ctx, 1)[0] ?? ctx.byConsensus.find((p) => !taken.has(p.id)) ?? null;
}

/**
 * Continues a draft from `picks` and returns the full pick list (existing picks first).
 * Ported from the prototype's simulateFrom(). Pure given `rng`.
 * Stops early at the user's pick when autoMe is false, or if the player pool runs out.
 */
export function simulateFrom(picks: DraftPick[], room: CpuStyle[], ctx: SimContext, { autoMe, rng }: SimulateOptions): DraftPick[] {
  const { teams, mySlot } = ctx.league;
  const out = picks.slice();
  const taken = new Set(picks.map((p) => p.playerId));
  const counts = slotCounts(picks, ctx);
  const homerTeams = HOMER_TEAMS.filter((t) => ctx.teams.includes(t));
  const favs = room.map((style) => (style === "homer" && homerTeams.length ? homerTeams[Math.floor(rng() * homerTeams.length)] : null));

  for (let n = out.length + 1; n <= ctx.total; n++) {
    const slot = slotOf(n, teams);
    const mine = slot === mySlot;
    let player;
    if (mine) {
      if (!autoMe) break;
      player = autoPickForMe(taken, counts[slot], n, ctx);
    } else {
      const idx = roomIndex(slot, mySlot);
      player = cpuPick(taken, counts[slot], roundOf(n, teams), room[idx] ?? "casual", favs[idx] ?? null, rng, ctx);
    }
    if (!player) break;
    taken.add(player.id);
    counts[slot][player.pos] = (counts[slot][player.pos] ?? 0) + 1;
    out.push({ playerId: player.id, mine });
  }
  return out;
}
