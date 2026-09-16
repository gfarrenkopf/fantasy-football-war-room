/**
 * Checks whatever dataset src/lib/data/index.ts loads, with no assumptions about the sample data.
 * Self-hosters run this on their own file with `npm run check-data`.
 *
 * The rules live in pipeline/qa.ts so the ingestion pipeline and this check can't drift
 * apart: a dataset that would be blocked at ingestion must also fail here.
 */
import { describe, expect, it } from "vitest";
import { dataset } from "./index";
import { runStructuralQa, STRUCTURAL_CHECKS } from "./pipeline/qa";

const report = runStructuralQa(dataset);
const failuresFor = (check: string) => report.failures.filter((f) => f.check === check).map((f) => f.message);

describe(`loaded dataset: ${dataset.label}`, () => {
  it("passes validation (fields, types, unique ids)", () => {
    // `dataset` is validated on import; getting here means the shape is valid.
    expect(dataset.players.length).toBeGreaterThan(0);
  });

  // One test per structural check, so a failure names the rule that broke.
  for (const check of STRUCTURAL_CHECKS) {
    it(`passes the ${check} check`, () => {
      expect(failuresFor(check)).toEqual([]);
    });
  }

  it("has no structural failures at all", () => {
    expect(report.failures.map((f) => `${f.check}: ${f.message}`)).toEqual([]);
  });
});
