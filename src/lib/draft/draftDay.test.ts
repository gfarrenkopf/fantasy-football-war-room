import { beforeAll, describe, expect, it, vi } from "vitest";
import { draftAtFields, draftCountdown, formatSpan, isDraftAt, parseDraftAt, toDraftAt } from "./draftDay";

// Pin the viewer to one timezone so local days and times are deterministic.
beforeAll(() => {
  vi.stubEnv("TZ", "America/New_York");
});

const at = (s: string) => new Date(s);

describe("parseDraftAt", () => {
  it("reads a date-only value as a calendar day", () => {
    expect(parseDraftAt("2026-09-27")).toEqual({ kind: "date", year: 2026, month: 9, day: 27 });
  });

  it("reads an instant as a moment", () => {
    const d = parseDraftAt("2026-09-28T00:00:00.000Z");
    expect(d?.kind).toBe("time");
  });

  it("rejects anything else", () => {
    for (const bad of [null, undefined, 42, "", "tomorrow", "2026-02-31", "2026-9-7", "2026-09-27T20:00", "2026-09-27 20:00Z"]) {
      expect(isDraftAt(bad)).toBe(false);
    }
  });
});

describe("toDraftAt and draftAtFields", () => {
  it("keeps a date without a time as the date", () => {
    expect(toDraftAt("2026-09-27")).toBe("2026-09-27");
    expect(toDraftAt("2026-09-27", "")).toBe("2026-09-27");
  });

  it("turns a local date and time into an instant, and back", () => {
    const stored = toDraftAt("2026-09-27", "20:00");
    expect(stored).toBe("2026-09-28T00:00:00.000Z");
    expect(draftAtFields(stored)).toEqual({ date: "2026-09-27", time: "20:00" });
  });

  it("gives nothing for no date", () => {
    expect(toDraftAt("", "20:00")).toBeNull();
    expect(draftAtFields(null)).toEqual({ date: "", time: "" });
  });
});

describe("draftCountdown", () => {
  const now = at("2026-09-24T14:00:00-04:00"); // Thu 2:00 PM in New York

  it("is null without a date", () => {
    expect(draftCountdown(null, now)).toBeNull();
    expect(draftCountdown("nope", now)).toBeNull();
  });

  it("counts a date-only draft in days", () => {
    expect(draftCountdown("2026-09-27", now, "en-US")).toMatchObject({ phase: "later", label: "in 3 days", when: "Sun, Sep 27", timed: false });
    expect(draftCountdown("2026-09-25", now, "en-US")).toMatchObject({ phase: "tomorrow", label: "tomorrow" });
    expect(draftCountdown("2026-09-24", now, "en-US")).toMatchObject({ phase: "today", label: "today" });
    expect(draftCountdown("2026-09-23", now, "en-US")).toMatchObject({ phase: "started" });
  });

  it("counts a timed draft to the minute", () => {
    expect(draftCountdown("2026-09-25T00:00:00.000Z", now, "en-US")).toMatchObject({ phase: "today", label: "tonight", when: "8:00 PM" });
    expect(draftCountdown("2026-09-24T18:15:00.000Z", now, "en-US")).toMatchObject({ phase: "soon", label: "in 15 min" });
    expect(draftCountdown("2026-09-26T00:00:00.000Z", now, "en-US")).toMatchObject({ phase: "tomorrow", when: "8:00 PM" });
    expect(draftCountdown("2026-09-28T00:00:00.000Z", now, "en-US")).toMatchObject({ phase: "later", label: "in 3 days", when: "Sun 8:00 PM" });
    expect(draftCountdown("2026-09-24T17:59:00.000Z", now, "en-US")).toMatchObject({ phase: "started" });
  });

  it("sees a timed draft at the same moment from anywhere", () => {
    const c = draftCountdown("2026-09-28T00:00:00.000Z", now, "en-US");
    expect(c?.ms).toBe(at("2026-09-28T00:00:00.000Z").getTime() - now.getTime());
  });
});

describe("formatSpan", () => {
  it("shows days and hours, hours and minutes, then a clock", () => {
    expect(formatSpan((3 * 24 + 4) * 3_600_000)).toBe("3d 4h");
    expect(formatSpan(5 * 3_600_000 + 12 * 60_000)).toBe("5h 12m");
    expect(formatSpan(12 * 60_000 + 4_000)).toBe("12:04");
    expect(formatSpan(-5)).toBe("0:00");
  });
});
