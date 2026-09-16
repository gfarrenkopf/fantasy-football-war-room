import { describe, expect, it } from "vitest";
import type { Dataset, Player } from "@/lib/draft/types";
import { dataset as shippedDataset } from "../index";
import { FIXTURE_SEASON, fixtureSnapshot } from "./fixtures";
import { normalize } from "./normalize";
import { formatQa, runQa, runStructuralQa } from "./qa";

const fixtureDataset = () => normalize(fixtureSnapshot(), { season: FIXTURE_SEASON, label: "test run" }).dataset;

/** Deep copy so a corruption test can't leak into the next one. */
const clone = (d: Dataset): Dataset => JSON.parse(JSON.stringify(d));

const failedChecks = (d: Dataset) => runQa(d).failures.map((f) => f.check);

describe("runQa on the shipped sample dataset", () => {
  it("passes every check", () => {
    // The sample is the known-good baseline; if it fails, a check is wrong, not the data.
    const report = runQa(shippedDataset);
    expect(report.failures.map((f) => `${f.check}: ${f.message}`)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe("runQa catches deliberately corrupted data", () => {
  it("fails when a bye week doesn't match the team's", () => {
    const d = clone(shippedDataset);
    d.players[3].bye = 99;
    expect(failedChecks(d)).toContain("bye-weeks-match");
  });

  it("fails when a team has no bye week at all", () => {
    const d = clone(shippedDataset);
    delete d.byeWeeks[d.players[0].team];
    expect(failedChecks(d)).toContain("bye-weeks-present");
  });

  it("fails on duplicate player ids", () => {
    const d = clone(shippedDataset);
    d.players[5] = { ...d.players[5], id: d.players[4].id };
    expect(failedChecks(d)).toContain("unique-ids");
  });

  it("fails when position ranks have a gap", () => {
    const d = clone(shippedDataset);
    const rb = d.players.find((p) => p.pos === "RB")!;
    rb.posRank = 999;
    expect(failedChecks(d)).toContain("pos-rank-contiguous");
  });

  it("fails when there aren't enough players for any preset", () => {
    const d = clone(shippedDataset);
    d.players = d.players.slice(0, 20);
    expect(failedChecks(d)).toContain("enough-players");
  });

  it("fails when a projection exceeds the plausible ceiling for its position", () => {
    const d = clone(shippedDataset);
    d.players.find((p) => p.pos === "RB")!.projPoints = 5000;
    expect(failedChecks(d)).toContain("projection-ceiling");
  });

  it("fails when a kicker is projected like a first-rounder", () => {
    // The scrambled-data signature the ticket was written for.
    const d = clone(shippedDataset);
    d.players.find((p) => p.pos === "K")!.projPoints = 400;
    expect(failedChecks(d)).toContain("late-positions-not-dominant");
  });

  it("fails when most players share one placeholder projection", () => {
    const d = clone(shippedDataset);
    for (const p of d.players) p.projPoints = 100;
    expect(failedChecks(d)).toContain("projections-not-degenerate");
  });

  it("fails when most players share one placeholder ADP", () => {
    const d = clone(shippedDataset);
    for (const p of d.players) p.adp = 50;
    expect(failedChecks(d)).toContain("adp-not-degenerate");
  });

  it("fails when a whole position is missing", () => {
    const d = clone(shippedDataset);
    d.players = d.players.filter((p) => p.pos !== "TE");
    expect(failedChecks(d)).toContain("positions-represented");
  });

  it("blocks publication for any failure", () => {
    const d = clone(shippedDataset);
    d.players[3].bye = 99;
    expect(runQa(d).ok).toBe(false);
  });
});

describe("runQa on the live trial fixtures", () => {
  it("rejects the free-trial projections as implausibly low", () => {
    // This is the epic's expected outcome, not a bug: the trial returns a top RB around
    // half a real season's points, so the gate must refuse to publish it.
    const report = runQa(fixtureDataset());
    expect(report.ok).toBe(false);
    expect(report.failures.map((f) => f.check)).toContain("projection-floor");
  });

  it("passes every structural check, because the shape is fine", () => {
    // Structure is the pipeline's responsibility; values are the vendor's.
    expect(runStructuralQa(fixtureDataset()).failures).toEqual([]);
  });
});

describe("formatQa", () => {
  it("names the check and the specific problem", () => {
    const d = clone(shippedDataset);
    const victim: Player = d.players[3];
    victim.bye = 99;
    const text = formatQa(runQa(d));
    expect(text).toContain("FAIL");
    expect(text).toContain("bye-weeks-match");
    expect(text).toContain(victim.name);
  });

  it("says so when everything passes", () => {
    expect(formatQa(runQa(shippedDataset))).toBe("QA: all checks passed.");
  });
});
