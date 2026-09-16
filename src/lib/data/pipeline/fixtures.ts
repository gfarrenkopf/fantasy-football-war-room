import type { SdBye, SdFantasyPlayer, SdSeasonProjection, SdSnapshot } from "../sportsdata/types";
import byes from "../__fixtures__/byes.json";
import fantasyPlayers from "../__fixtures__/fantasy-players.json";
import projections from "../__fixtures__/projections.json";

/**
 * The committed SportsDataIO fixtures (2.0), so tests exercise the pipeline with no
 * network and no API key.
 *
 * These are real trial-tier responses, trimmed and redacted by
 * `npm run capture-fixtures`. They prove the response *shape* and the pipeline's
 * behaviour. They do not prove the data is correct — it isn't, which is exactly what
 * the QA gate exists to detect. Never assert that a fixture value is a true player fact.
 */
/**
 * Returns a fresh deep copy every call. Tests corrupt snapshots on purpose, and the
 * imported JSON is a single shared module object — handing it out directly would let
 * one test's mutation change another's input.
 */
export const fixtureSnapshot = (): SdSnapshot =>
  structuredClone({
    fantasyPlayers: fantasyPlayers as SdFantasyPlayer[],
    projections: projections as SdSeasonProjection[],
    byes: byes as SdBye[],
  });

export const FIXTURE_SEASON = 2026;
