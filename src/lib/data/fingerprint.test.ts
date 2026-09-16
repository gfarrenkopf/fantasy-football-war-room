import { describe, expect, it } from "vitest";
import { dataset } from "./index";
import { datasetId } from "./fingerprint";

describe("datasetId", () => {
  it("is stable across reorderings and ADP changes", () => {
    const shuffled = { season: dataset.season, players: [...dataset.players].reverse().map((p) => ({ ...p, adp: p.adp + 1 })) };
    expect(datasetId(shuffled)).toBe(datasetId(dataset));
  });

  it("changes when players or the season change", () => {
    expect(datasetId({ ...dataset, players: dataset.players.slice(1) })).not.toBe(datasetId(dataset));
    expect(datasetId({ ...dataset, season: dataset.season + 1 })).not.toBe(datasetId(dataset));
  });

  it("starts with the season", () => {
    expect(datasetId(dataset)).toMatch(new RegExp(`^${dataset.season}-[0-9a-f]{8}$`));
  });
});
