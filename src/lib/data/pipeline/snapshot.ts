import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Dataset } from "@/lib/draft/types";
import { validateDataset } from "../loadDataset";
import type { Changelog } from "./changelog";
import type { QaReport } from "./qa";
import type { TierCheckReport } from "./tierCheck";

/**
 * Snapshot storage and rollback (2.7).
 *
 *   data/snapshots/<run-id>/raw/*.json      untouched responses
 *   data/snapshots/<run-id>/dataset.json    normalized + validated
 *   data/snapshots/<run-id>/report.json     QA results + changelog
 *   data/live.json                          the published dataset
 *
 * Keeping the raw responses means a bad normalization can be re-run without re-fetching,
 * which matters on a metered key. Publishing copies a snapshot's dataset to `live.json`;
 * rollback republishes an older one. A QA failure writes the snapshot and report but
 * leaves `live.json` untouched.
 */

export const DATA_DIR = "data";
export const SNAPSHOTS_DIR = join(DATA_DIR, "snapshots");
export const LIVE_PATH = join(DATA_DIR, "live.json");

export interface RunReport {
  runId: string;
  startedAt: string;
  season: number;
  /** Which endpoints answered, and how many rows each returned. */
  sources: Record<string, number>;
  dropped: { name: string; reason: string }[];
  qa: QaReport;
  tiers: TierCheckReport;
  changelog: Changelog | null;
  published: boolean;
  /** Why the run did not publish, when it didn't. */
  blockedBy?: string;
}

/** Filesystem-safe, sorts chronologically: 2026-09-15T12-00-00Z. */
export function newRunId(now = new Date()): string {
  return now.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
}

const write = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

export interface WriteSnapshotArgs {
  runId: string;
  dataset: Dataset;
  report: RunReport;
  /** Raw responses, keyed by the filename they get under raw/. */
  raw: Record<string, unknown>;
  root?: string;
}

export function writeSnapshot({ runId, dataset, report, raw, root = "." }: WriteSnapshotArgs): string {
  const dir = join(root, SNAPSHOTS_DIR, runId);
  mkdirSync(join(dir, "raw"), { recursive: true });
  for (const [name, body] of Object.entries(raw)) write(join(dir, "raw", `${name}.json`), body);
  write(join(dir, "dataset.json"), dataset);
  write(join(dir, "report.json"), report);
  return dir;
}

/** Newest first. */
export function listSnapshots(root = "."): string[] {
  const dir = join(root, SNAPSHOTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse();
}

export function readSnapshotDataset(runId: string, root = "."): Dataset {
  const path = join(root, SNAPSHOTS_DIR, runId, "dataset.json");
  return validateDataset(JSON.parse(readFileSync(path, "utf8")));
}

/** The published dataset, or null when nothing has been published yet. */
export function readLive(root = "."): Dataset | null {
  const path = join(root, LIVE_PATH);
  if (!existsSync(path)) return null;
  return validateDataset(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Publishes a snapshot's dataset as `live.json`. Validates before writing, so a corrupt
 * snapshot can't take down the app — the build's check-data step would fail on it later,
 * but failing here is a much better error.
 */
export function publish(runId: string, root = "."): Dataset {
  const dataset = readSnapshotDataset(runId, root);
  mkdirSync(join(root, DATA_DIR), { recursive: true });
  write(join(root, LIVE_PATH), dataset);
  return dataset;
}

/**
 * Rolls back to the most recent snapshot before the live one, or a named snapshot.
 * Returns the run id that is now live.
 */
export function rollback(runId: string | undefined, root = "."): string {
  const snapshots = listSnapshots(root);
  if (!snapshots.length) throw new Error("no snapshots to roll back to");

  if (runId) {
    if (!snapshots.includes(runId)) throw new Error(`no snapshot "${runId}" (have: ${snapshots.slice(0, 5).join(", ")})`);
    publish(runId, root);
    return runId;
  }

  const live = readLive(root);
  // Match by label, the one field that identifies which run produced a dataset.
  const currentIndex = live ? snapshots.findIndex((id) => safeLabel(id, root) === live.label) : -1;
  const target = snapshots[currentIndex + 1];
  if (!target) throw new Error("no earlier snapshot to roll back to");
  publish(target, root);
  return target;
}

function safeLabel(runId: string, root: string): string | null {
  try {
    return readSnapshotDataset(runId, root).label;
  } catch {
    return null;
  }
}
