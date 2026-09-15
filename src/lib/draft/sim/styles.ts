import type { CpuStyle } from "../types";

export interface StyleDef {
  label: string;
  /** Which ranking the style starts from: platform ADP (casual drafters) or expert consensus. */
  base: "adp" | "consensus";
  /** Softmax temperature for the weighted-random pick. Higher = more random. */
  temp: number;
}

/** CPU drafter personalities, ported from the prototype's STYLES. */
export const STYLES: Record<CpuStyle, StyleDef> = {
  casual: { label: "Casual — follows platform ADP", base: "adp", temp: 5 },
  sharp: { label: "Sharp — drafts by expert ranks", base: "consensus", temp: 2.5 },
  qbEarly: { label: "QB early (rounds 2–5)", base: "adp", temp: 4 },
  zeroRB: { label: "Zero-RB — WR/TE early", base: "adp", temp: 4 },
  rbHeavy: { label: "RB heavy — pounds RBs early", base: "adp", temp: 4 },
  teReach: { label: "Reaches for a TE", base: "adp", temp: 4 },
  homer: { label: "Homer — overdrafts one team", base: "adp", temp: 4 },
  chaos: { label: "Chaotic — anything goes", base: "adp", temp: 11 },
};

export const CPU_STYLES = Object.keys(STYLES) as CpuStyle[];

/** The prototype's 11-team room (slots 2..12). About half casual, one of each other style. */
const PROTOTYPE_ROOM: CpuStyle[] = ["casual", "sharp", "qbEarly", "casual", "zeroRB", "rbHeavy", "casual", "teReach", "homer", "casual", "chaos"];

/** Default CPU room for a league: the prototype's pattern, cycled or trimmed to teams - 1 opponents. */
export const defaultRoom = (teams: number): CpuStyle[] =>
  Array.from({ length: Math.max(0, teams - 1) }, (_, i) => PROTOTYPE_ROOM[i % PROTOTYPE_ROOM.length]);

/** Returns `room` if it fits the league, otherwise the default room. */
export const roomFor = (room: CpuStyle[] | null | undefined, teams: number): CpuStyle[] =>
  room && room.length === teams - 1 && room.every((s) => s in STYLES) ? room : defaultRoom(teams);

/** Teams a homer might favor, from the prototype. Filtered to teams in the dataset at runtime. */
export const HOMER_TEAMS = ["DAL", "PHI", "KC", "BUF", "DET", "SF", "BAL", "GB", "MIA", "CIN", "LAR", "MIN", "NE", "NYG", "TB", "DEN", "SEA", "HOU", "LAC", "CHI"];
