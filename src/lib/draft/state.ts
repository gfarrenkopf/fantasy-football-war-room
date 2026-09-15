import type { DraftPick, DraftState } from "./types";

export const DRAFT_STATE_VERSION = 1;

export const emptyDraftState = (): DraftState => ({ version: DRAFT_STATE_VERSION, picks: [] });

export type DraftAction =
  /** Log a pick for an available player. Ignored if he's already taken or the draft is full. */
  | { type: "draft"; playerId: string; mine: boolean; totalPicks: number }
  /** Move an already-taken player to or from the user's roster, keeping his pick number. */
  | { type: "setMine"; playerId: string; mine: boolean }
  /** Put a taken player back on the board. Later picks move up one spot. */
  | { type: "untake"; playerId: string }
  | { type: "undo" }
  | { type: "reset" }
  /** Append simulated picks. Stops at the first already-taken player or when the draft is full. */
  | { type: "appendPicks"; picks: DraftPick[]; totalPicks: number }
  /** Replace state with a loaded draft. */
  | { type: "hydrate"; state: DraftState };

const indexOf = (state: DraftState, playerId: string) => state.picks.findIndex((p) => p.playerId === playerId);

/** Pure draft reducer, ported from the prototype's draft(), untake(), undo and reset handlers. */
export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "draft": {
      if (indexOf(state, action.playerId) >= 0 || state.picks.length >= action.totalPicks) return state;
      return { ...state, picks: [...state.picks, { playerId: action.playerId, mine: action.mine }] };
    }
    case "setMine": {
      const i = indexOf(state, action.playerId);
      if (i < 0 || state.picks[i].mine === action.mine) return state;
      const picks = state.picks.slice();
      picks[i] = { ...picks[i], mine: action.mine };
      return { ...state, picks };
    }
    case "untake": {
      const i = indexOf(state, action.playerId);
      return i < 0 ? state : { ...state, picks: state.picks.filter((_, j) => j !== i) };
    }
    case "undo":
      return state.picks.length ? { ...state, picks: state.picks.slice(0, -1) } : state;
    case "reset":
      return state.picks.length ? emptyDraftState() : state;
    case "appendPicks": {
      const taken = new Set(state.picks.map((p) => p.playerId));
      const picks = state.picks.slice();
      for (const p of action.picks) {
        if (picks.length >= action.totalPicks || taken.has(p.playerId)) break;
        taken.add(p.playerId);
        picks.push({ playerId: p.playerId, mine: p.mine });
      }
      return picks.length === state.picks.length ? state : { ...state, picks };
    }
    case "hydrate":
      return action.state;
  }
}

/** playerId → { mine, n } where n is the 1-based pick number. The prototype's takenMap(). */
export function takenMap(state: DraftState): Map<string, { mine: boolean; n: number }> {
  return new Map(state.picks.map((p, i) => [p.playerId, { mine: p.mine, n: i + 1 }]));
}

/** The pick currently on the clock (1-based). Exceeds totalPicks when the draft is complete. */
export const currentPick = (state: DraftState): number => state.picks.length + 1;
