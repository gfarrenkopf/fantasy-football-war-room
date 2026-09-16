import { describe, expect, it } from "vitest";
import { NO_PLAN, PLAN_OVERDUE_MS, planFallback, type PlanView } from "./planView";

const view = (patch: Partial<PlanView>): PlanView => ({ ...NO_PLAN, ...patch });
const plan = { intro: "Plan.", turns: [] };

describe("planFallback", () => {
  it("falls back to the live plan when the job failed, with or without an older plan", () => {
    expect(planFallback(view({ status: "failed", error: { kind: "unavailable", retryable: true } }), false, 0)).toBe("failed");
    expect(planFallback(view({ status: "failed", plan }), false, 0)).toBe("failed");
  });

  it("falls back when the server can't be reached, whatever the last view said", () => {
    expect(planFallback(null, true, 0)).toBe("unreachable");
    expect(planFallback(view({ status: "ready", plan }), true, 0)).toBe("unreachable");
  });

  it("shows the live plan while a plan is written, and flags one that's overdue", () => {
    expect(planFallback(view({ status: "queued" }), false, 1_000)).toBe("writing");
    expect(planFallback(view({ status: "generating" }), false, 60_000)).toBe("writing");
    expect(planFallback(view({ status: "generating" }), false, PLAN_OVERDUE_MS + 1)).toBe("slow");
  });

  it("needs no fallback for a ready plan, before a plan is requested, or while loading", () => {
    expect(planFallback(view({ status: "ready", plan }), false, 0)).toBeNull();
    expect(planFallback(NO_PLAN, false, 0)).toBeNull();
    expect(planFallback(null, false, 0)).toBeNull();
  });
});
