import { POSITIONS, type Dataset, type Player, type ScoringFormat } from "@/lib/draft/types";

const SCORING: ScoringFormat[] = ["ppr", "half", "std"];

export class DatasetError extends Error {
  constructor(message: string) {
    super(`Invalid dataset: ${message}`);
    this.name = "DatasetError";
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function validatePlayer(p: unknown, i: number): Player {
  const where = `players[${i}]`;
  if (!isObj(p)) throw new DatasetError(`${where} is not an object`);
  for (const key of ["id", "name", "team"] as const) {
    if (!isStr(p[key])) throw new DatasetError(`${where}.${key} must be a non-empty string`);
  }
  if (!POSITIONS.includes(p.pos as Player["pos"])) {
    throw new DatasetError(`${where}.pos must be one of ${POSITIONS.join(", ")}`);
  }
  for (const key of ["bye", "consensusRank", "adp", "posRank"] as const) {
    if (!isNum(p[key])) throw new DatasetError(`${where}.${key} (${p.name}) must be a number`);
  }
  if (p.note !== undefined && typeof p.note !== "string") throw new DatasetError(`${where}.note must be a string`);
  if (p.projPoints !== undefined && !isNum(p.projPoints)) throw new DatasetError(`${where}.projPoints must be a number`);
  return p as unknown as Player;
}

/**
 * Validates untrusted JSON (the bundled sample or a self-hoster's own file) against the Dataset shape.
 * Throws a DatasetError naming the first problem found.
 */
export function validateDataset(raw: unknown): Dataset {
  if (!isObj(raw)) throw new DatasetError("root must be an object");
  if (!isNum(raw.season)) throw new DatasetError("season must be a number");
  if (!isStr(raw.label)) throw new DatasetError("label must be a non-empty string");
  if (!isStr(raw.adpSource)) throw new DatasetError("adpSource must be a non-empty string");
  if (!Array.isArray(raw.scoring) || !raw.scoring.length || !raw.scoring.every((s) => SCORING.includes(s))) {
    throw new DatasetError(`scoring must be a non-empty array of ${SCORING.join(", ")}`);
  }
  if (!isObj(raw.byeWeeks) || !Object.values(raw.byeWeeks).every(isNum)) {
    throw new DatasetError("byeWeeks must map team abbreviations to week numbers");
  }
  if (!Array.isArray(raw.players) || !raw.players.length) throw new DatasetError("players must be a non-empty array");

  const players = raw.players.map(validatePlayer);
  const seen = new Set<string>();
  for (const p of players) {
    if (seen.has(p.id)) throw new DatasetError(`duplicate player id "${p.id}"`);
    seen.add(p.id);
  }
  return raw as unknown as Dataset;
}

/** Player lookup by id, built once per dataset. */
export function indexPlayers(dataset: Dataset): Map<string, Player> {
  return new Map(dataset.players.map((p) => [p.id, p]));
}
