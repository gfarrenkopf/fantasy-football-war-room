import { describe, expect, it } from "vitest";
import { clockDeadline, clockUrgency, formatClock } from "./live";

describe("ESPN pick clock", () => {
  it("turns the time left into a deadline on this device's clock", () => {
    expect(clockDeadline({ teamId: 3, msRemaining: 45_000 }, 1_000)).toEqual({ teamId: 3, deadline: 46_000 });
    expect(clockDeadline(null, 1_000)).toBeNull();
  });

  it("formats minutes and seconds, rounding up and never going negative", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(9_000)).toBe("0:09");
    expect(formatClock(8_001)).toBe("0:09");
    expect(formatClock(1)).toBe("0:01");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-4_000)).toBe("0:00");
  });

  it("gets low at 30 seconds and urgent at 10", () => {
    expect(clockUrgency(30_001)).toBe("ok");
    expect(clockUrgency(30_000)).toBe("low");
    expect(clockUrgency(10_000)).toBe("urgent");
  });
});
