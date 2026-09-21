import { describe, expect, it } from "vitest";
import { dataset, DATASET_ID, DEFAULT_LEAGUE } from "@/lib/data";
import { MAX_LEAGUE_NAME } from "./records";
import { newLeagueRecord } from "./newLeague";

describe("newLeagueRecord", () => {
  it("stamps the loaded dataset's season and fingerprint", () => {
    const record = newLeagueRecord("My league", DEFAULT_LEAGUE);
    expect(record.season).toBe(dataset.season);
    expect(record.datasetId).toBe(DATASET_ID);
    expect(record.settings).toBe(DEFAULT_LEAGUE);
    expect(record.createdAt).toBe(record.updatedAt);
    expect(record.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives every league its own id", () => {
    expect(newLeagueRecord("a", DEFAULT_LEAGUE).id).not.toBe(newLeagueRecord("a", DEFAULT_LEAGUE).id);
  });

  it("trims and clamps the name, so no caller has to", () => {
    expect(newLeagueRecord("  Apeman Dynasty  ", DEFAULT_LEAGUE).name).toBe("Apeman Dynasty");
    expect(newLeagueRecord("x".repeat(MAX_LEAGUE_NAME + 20), DEFAULT_LEAGUE).name).toHaveLength(MAX_LEAGUE_NAME);
  });
});
