import { describe, expect, it } from "vitest";
import type { Dataset } from "@/lib/draft/types";
import { dataset as shippedDataset } from "../index";
import { FIXTURE_SEASON, fixtureSnapshot } from "./fixtures";
import { normalize } from "./normalize";
import { checkTiers, topBoard } from "./tierCheck";

const clone = (d: Dataset): Dataset => JSON.parse(JSON.stringify(d));
const fixtureDataset = () => normalize(fixtureSnapshot(), { season: FIXTURE_SEASON, label: "test run" }).dataset;

describe("checkTiers", () => {
  it("passes the shipped sample under every preset", () => {
    const report = checkTiers(shippedDataset);
    expect(report.findings.map((f) => f.message)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("summarizes all three league presets", () => {
    expect(checkTiers(shippedDataset).presets.map((p) => p.teams)).toEqual([10, 12, 14]);
  });

  it("fills every real tier", () => {
    for (const preset of checkTiers(shippedDataset).presets) {
      expect(preset.tierCounts.slice(0, 4).every((n) => n > 0), preset.preset).toBe(true);
    }
  });

  it("catches consensusRank being copied from adp", () => {
    // The exact failure mode 2.1b exists to prevent: Value/Reach silently goes dead.
    const d = clone(shippedDataset);
    for (const p of d.players) p.consensusRank = Math.round(p.adp);
    const report = checkTiers(d);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.message.includes("copy of adp"))).toBe(true);
  });

  it("catches a board where almost everything is tagged the same way", () => {
    // What a scale mismatch between adp and consensusRank looks like: ~92% "Value".
    const d = clone(shippedDataset);
    for (const p of d.players) p.adp = p.consensusRank + 100;
    const report = checkTiers(d);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.message.includes("different scales"))).toBe(true);
  });

  it("accepts the balanced distribution the real pipeline produces", () => {
    const report = checkTiers(fixtureDataset());
    expect(report.ok).toBe(true);
    for (const preset of report.presets) {
      expect(preset.tagShares.value, preset.preset).toBeLessThan(0.6);
      expect(preset.tagShares.reach, preset.preset).toBeLessThan(0.6);
    }
  });
});

describe("topBoard", () => {
  it("lists players in consensus-rank order", () => {
    const lines = topBoard(shippedDataset, 5);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain(shippedDataset.players.slice().sort((a, b) => a.consensusRank - b.consensusRank)[0].name);
  });
});
