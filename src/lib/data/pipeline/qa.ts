import { validateLeague } from "@/lib/draft/league";
import { totalPicks } from "@/lib/draft/snake";
import { LATE_POSITIONS, POSITIONS, type Dataset, type Position } from "@/lib/draft/types";
import { LEAGUE_PRESETS } from "../presets";

/**
 * Data QA gate (2.6). A run that fails here must not be published.
 *
 * Two severities. A **failure** blocks publication: the data is structurally wrong or
 * so implausible that drafting on it would be worse than drafting on nothing. A
 * **warning** is recorded in the run report and lets the run through, so one odd
 * projection doesn't block an otherwise good refresh.
 *
 * This module is shared: `loaded-dataset.test.ts` (the `npm run check-data` target)
 * runs the same structural checks against whatever dataset the app has loaded, so the
 * rules can't drift between the pipeline and the shipped data.
 */

export type Severity = "failure" | "warning";

export interface Finding {
  severity: Severity;
  check: string;
  message: string;
}

export interface QaReport {
  findings: Finding[];
  failures: Finding[];
  warnings: Finding[];
  /** True when nothing blocks publication. */
  ok: boolean;
}

/** Plausible season point ceilings per position, generous by design. */
const MAX_PLAUSIBLE_POINTS: Readonly<Record<Position, number>> = Object.freeze({
  QB: 600,
  RB: 500,
  WR: 500,
  TE: 400,
  K: 250,
  DST: 250,
});

/** A kicker outscoring the best RB is the classic scrambled-data signature. */
const LATE_POSITION_CEILING = 200;

/**
 * The *best* player at each position should clear these in a full-PPR season. Real
 * leaders land far above them, so anything under is a sign the projections are scaled,
 * partial, or scrambled — the free trial returns a top RB around 181, roughly half a
 * real season.
 *
 * A uniform scale factor would be harmless (VORP order and tier breaks both survive it),
 * but we can't tell uniform scaling apart from per-player corruption, which isn't
 * harmless at all. So this blocks publication rather than warning.
 */
const MIN_PLAUSIBLE_TOP_POINTS: Readonly<Partial<Record<Position, number>>> = Object.freeze({
  QB: 280,
  RB: 250,
  WR: 250,
  TE: 150,
});

/**
 * Whether this dataset carries projections at all. `projPoints` is optional, and a
 * rank-only dataset is a first-class case — the shipped sample is one. Projection
 * checks skip entirely rather than reporting the absence as corruption.
 */
const hasProjections = (dataset: Dataset): boolean => dataset.players.some((p) => p.projPoints !== undefined);

type Check = (dataset: Dataset, add: (severity: Severity, message: string) => void) => void;

const CHECKS: Record<string, Check> = {
  /** Structural: lifted from the original check-data assertions. */
  "bye-weeks-match": (dataset, add) => {
    const wrong = dataset.players.filter((p) => dataset.byeWeeks[p.team] !== p.bye);
    if (wrong.length) {
      add("failure", `${wrong.length} player(s) whose bye doesn't match byeWeeks[team], e.g. ${wrong[0].name} (${wrong[0].team})`);
    }
  },

  "bye-weeks-present": (dataset, add) => {
    const teams = new Set(dataset.players.map((p) => p.team));
    const missing = [...teams].filter((t) => !(t in dataset.byeWeeks));
    if (missing.length) add("failure", `no bye week for team(s): ${missing.join(", ")}`);
  },

  "pos-rank-contiguous": (dataset, add) => {
    for (const pos of POSITIONS) {
      const ranks = dataset.players
        .filter((p) => p.pos === pos)
        .map((p) => p.posRank)
        .sort((a, b) => a - b);
      const wrong = ranks.findIndex((r, i) => r !== i + 1);
      if (wrong >= 0) add("failure", `${pos} posRank is not contiguous 1..n (first gap at ${ranks[wrong]})`);
    }
  },

  "unique-ids": (dataset, add) => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const p of dataset.players) {
      if (seen.has(p.id)) dupes.add(p.id);
      seen.add(p.id);
    }
    if (dupes.size) add("failure", `duplicate player id(s): ${[...dupes].slice(0, 5).join(", ")}`);
  },

  "enough-players": (dataset, add) => {
    const fits = LEAGUE_PRESETS.filter((p) => validateLeague({ ...p.league, scoring: dataset.scoring[0] }, dataset).length === 0);
    if (!fits.length) {
      const smallest = LEAGUE_PRESETS[0].league;
      add("failure", `not enough players for even a ${smallest.teams}-team league (needs ~${totalPicks(smallest) + 10}, has ${dataset.players.length})`);
    }
  },

  "late-position-coverage": (dataset, add) => {
    const smallest = LEAGUE_PRESETS[0].league.teams;
    for (const pos of LATE_POSITIONS) {
      const n = dataset.players.filter((p) => p.pos === pos).length;
      if (n < smallest) add("failure", `only ${n} ${pos} for a ${smallest}-team league (needs one per team)`);
    }
  },

  /** Plausibility. */
  "projection-ceiling": (dataset, add) => {
    const absurd = dataset.players.filter((p) => p.projPoints !== undefined && p.projPoints > MAX_PLAUSIBLE_POINTS[p.pos]);
    if (absurd.length) {
      const worst = absurd.sort((a, b) => b.projPoints! - a.projPoints!)[0];
      add("failure", `${absurd.length} player(s) above the plausible ceiling for their position, worst: ${worst.name} (${worst.pos}) at ${worst.projPoints}`);
    }
  },

  "projection-floor": (dataset, add) => {
    for (const [pos, floor] of Object.entries(MIN_PLAUSIBLE_TOP_POINTS) as [Position, number][]) {
      const points = dataset.players.filter((p) => p.pos === pos && p.projPoints !== undefined).map((p) => p.projPoints!);
      if (!points.length) continue;
      const best = Math.max(...points);
      if (best < floor) {
        add("failure", `best ${pos} is projected for only ${best} points (expected at least ${floor} in full PPR) — projections look scaled or partial`);
      }
    }
  },

  "late-positions-not-dominant": (dataset, add) => {
    const late = dataset.players.filter((p) => LATE_POSITIONS.includes(p.pos) && p.projPoints !== undefined);
    const offenders = late.filter((p) => p.projPoints! > LATE_POSITION_CEILING);
    if (offenders.length) {
      add("failure", `${offenders.length} K/DST projected above ${LATE_POSITION_CEILING} points, e.g. ${offenders[0].name} at ${offenders[0].projPoints} — the signature of scrambled projections`);
    }
  },

  /**
   * Partial projection coverage, which is a different problem from having none.
   * `projPoints` is optional: a rank-only dataset (the shipped sample, or a
   * self-hoster's ECR export) is perfectly valid, and every projection check below
   * is skipped for one. But a dataset that projects most players and not its best
   * ones has a join problem.
   */
  "top-players-have-projections": (dataset, add) => {
    if (!hasProjections(dataset)) return;
    const top = dataset.players.filter((p) => !LATE_POSITIONS.includes(p.pos)).slice(0, 50);
    const missing = top.filter((p) => p.projPoints === undefined);
    if (missing.length > 5) {
      add("warning", `${missing.length} of the top 50 players have no projection, e.g. ${missing[0].name}`);
    }
  },

  /** Distributional: the tells of placeholder or trial-tier data. */
  "projections-not-degenerate": (dataset, add) => {
    if (!hasProjections(dataset)) return;
    const withPoints = dataset.players.filter((p) => p.projPoints !== undefined);
    const counts = new Map<number, number>();
    for (const p of withPoints) counts.set(p.projPoints!, (counts.get(p.projPoints!) ?? 0) + 1);
    const [value, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (n / withPoints.length > 0.25) {
      add("failure", `${Math.round((n / withPoints.length) * 100)}% of projections share the identical value ${value} — placeholder data`);
    }
  },

  "adp-not-degenerate": (dataset, add) => {
    const counts = new Map<number, number>();
    for (const p of dataset.players) counts.set(p.adp, (counts.get(p.adp) ?? 0) + 1);
    const [value, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (n / dataset.players.length > 0.25) {
      add("failure", `${Math.round((n / dataset.players.length) * 100)}% of players share the identical ADP ${value} — placeholder data`);
    }
  },

  "positions-represented": (dataset, add) => {
    for (const pos of POSITIONS) {
      if (!dataset.players.some((p) => p.pos === pos)) add("failure", `no ${pos} in the dataset`);
    }
  },
};

export function runQa(dataset: Dataset): QaReport {
  const findings: Finding[] = [];
  for (const [check, fn] of Object.entries(CHECKS)) {
    fn(dataset, (severity, message) => findings.push({ severity, check, message }));
  }
  const failures = findings.filter((f) => f.severity === "failure");
  const warnings = findings.filter((f) => f.severity === "warning");
  return { findings, failures, warnings, ok: failures.length === 0 };
}

/** One line per finding, in the style of the existing `Invalid dataset: …` messages. */
export function formatQa(report: QaReport): string {
  if (!report.findings.length) return "QA: all checks passed.";
  return report.findings.map((f) => `${f.severity === "failure" ? "FAIL" : "WARN"} [${f.check}] ${f.message}`).join("\n");
}

/** The structural subset, for reuse by check-data against an already-loaded dataset. */
export const STRUCTURAL_CHECKS = ["bye-weeks-match", "bye-weeks-present", "pos-rank-contiguous", "unique-ids", "enough-players", "late-position-coverage"] as const;

export function runStructuralQa(dataset: Dataset): QaReport {
  const findings: Finding[] = [];
  for (const check of STRUCTURAL_CHECKS) {
    CHECKS[check](dataset, (severity, message) => findings.push({ severity, check, message }));
  }
  const failures = findings.filter((f) => f.severity === "failure");
  return { findings, failures, warnings: findings.filter((f) => f.severity === "warning"), ok: failures.length === 0 };
}

