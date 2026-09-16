import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/lib/draft/types";
import { dataset as shippedDataset } from "../index";
import { runQa } from "./qa";
import { checkTiers } from "./tierCheck";
import {
  LIVE_PATH,
  listSnapshots,
  newRunId,
  publish,
  readLive,
  readSnapshotDataset,
  rollback,
  writeSnapshot,
  type RunReport,
} from "./snapshot";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "war-room-snapshot-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const labelled = (label: string): Dataset => ({ ...shippedDataset, label });

const report = (runId: string, dataset: Dataset): RunReport => ({
  runId,
  startedAt: new Date().toISOString(),
  season: 2026,
  sources: { fantasyPlayers: 1 },
  dropped: [],
  qa: runQa(dataset),
  tiers: checkTiers(dataset),
  changelog: null,
  published: false,
});

const store = (label: string, raw: Record<string, unknown> = {}) => {
  const runId = newRunId(new Date(Date.now() + listSnapshots(root).length * 1000));
  const dataset = labelled(label);
  writeSnapshot({ runId, dataset, report: report(runId, dataset), raw, root });
  return runId;
};

describe("newRunId", () => {
  it("is filesystem-safe and sorts chronologically", () => {
    const early = newRunId(new Date("2026-09-15T12:00:00Z"));
    const late = newRunId(new Date("2026-09-16T12:00:00Z"));
    expect(early).not.toContain(":");
    expect([late, early].sort()).toEqual([early, late]);
  });
});

describe("writeSnapshot", () => {
  it("writes the dataset, the report and the raw responses", () => {
    const runId = store("run one", { "fantasy-players": [{ PlayerID: 1 }] });
    const dir = join(root, "data", "snapshots", runId);
    expect(existsSync(join(dir, "dataset.json"))).toBe(true);
    expect(existsSync(join(dir, "report.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "raw", "fantasy-players.json"), "utf8"))).toEqual([{ PlayerID: 1 }]);
  });

  it("keeps raw responses so a re-run needs no API calls", () => {
    const runId = store("run one", { byes: [{ Season: 2026, Week: 5, Team: "CAR" }] });
    const raw = JSON.parse(readFileSync(join(root, "data", "snapshots", runId, "raw", "byes.json"), "utf8"));
    expect(raw[0].Team).toBe("CAR");
  });

  it("round-trips a dataset through validation", () => {
    const runId = store("run one");
    expect(readSnapshotDataset(runId, root).label).toBe("run one");
  });
});

describe("listSnapshots", () => {
  it("is empty before anything has run", () => {
    expect(listSnapshots(root)).toEqual([]);
  });

  it("lists newest first", () => {
    const first = store("first");
    const second = store("second");
    expect(listSnapshots(root)).toEqual([second, first]);
  });
});

describe("publish", () => {
  it("makes a snapshot's dataset live", () => {
    const runId = store("run one");
    publish(runId, root);
    expect(readLive(root)?.label).toBe("run one");
  });

  it("reads back as null before anything is published", () => {
    expect(readLive(root)).toBeNull();
  });

  it("refuses to publish a corrupt snapshot", () => {
    const runId = store("run one");
    const path = join(root, "data", "snapshots", runId, "dataset.json");
    rmSync(path);
    expect(() => publish(runId, root)).toThrow();
    expect(existsSync(join(root, LIVE_PATH))).toBe(false);
  });
});

describe("rollback", () => {
  it("returns to the previous snapshot", () => {
    const first = store("first");
    const second = store("second");
    publish(second, root);

    expect(rollback(undefined, root)).toBe(first);
    expect(readLive(root)?.label).toBe("first");
  });

  it("can target a named snapshot", () => {
    const first = store("first");
    store("second");
    expect(rollback(first, root)).toBe(first);
    expect(readLive(root)?.label).toBe("first");
  });

  it("explains itself when the named snapshot doesn't exist", () => {
    store("first");
    expect(() => rollback("nope", root)).toThrow(/no snapshot "nope"/);
  });

  it("refuses when there is nothing to roll back to", () => {
    expect(() => rollback(undefined, root)).toThrow(/no snapshots/);
  });

  it("refuses when the live snapshot is already the oldest", () => {
    const only = store("only");
    publish(only, root);
    expect(() => rollback(undefined, root)).toThrow(/no earlier snapshot/);
  });
});
