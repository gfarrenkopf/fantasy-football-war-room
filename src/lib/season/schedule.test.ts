import { describe, expect, it } from "vitest";
import raw from "./__fixtures__/espn-schedule-2026.json";
import { dueKickoff, earlyKickoffs, parseSchedule } from "./schedule";

const schedule = parseSchedule(raw);
const et = (at: number) => new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });

describe("parseSchedule", () => {
  it("reads each team's kickoff by week, and leaves out games without a time", () => {
    expect(schedule.get(4)?.get("PHI")).toBe(1791133200000);
    // Week 16's flexed games are parked at 3:01 AM with startTimeTBD.
    expect([...(schedule.get(16)?.values() ?? [])].map(et)).not.toContain("Sun 3:01 AM");
  });
});

describe("earlyKickoffs", () => {
  it("finds Thursday night and the London morning game in week 4", () => {
    expect(earlyKickoffs(schedule.get(4)!).map(et)).toEqual(["Thu 8:15 PM", "Sun 9:30 AM"]);
  });

  it("finds the Saturday games in week 15 and Christmas in week 16", () => {
    expect(earlyKickoffs(schedule.get(15)!).map(et)).toEqual(["Thu 8:15 PM", "Sat 5:00 PM", "Sat 8:20 PM"]);
    expect(earlyKickoffs(schedule.get(16)!).map(et)).toEqual(["Thu 8:15 PM", "Fri 1:00 PM", "Fri 4:30 PM", "Fri 8:15 PM"]);
  });
});

describe("dueKickoff", () => {
  const [thursday] = earlyKickoffs(schedule.get(4)!);
  const min = 60 * 1000;

  it("is due from 75 minutes before kickoff, for one 15-minute window", () => {
    expect(dueKickoff(schedule, thursday - 75 * min)).toMatchObject({ week: 4, at: thursday });
    expect(dueKickoff(schedule, thursday - 61 * min)?.at).toBe(thursday);
    expect(dueKickoff(schedule, thursday - 60 * min)).toBeNull();
    expect(dueKickoff(schedule, thursday - 76 * min)).toBeNull();
  });

  it("names the teams playing then", () => {
    expect(dueKickoff(schedule, thursday - 70 * min)!.teams).toHaveLength(2);
  });

  it("is never due for the main Sunday slot", () => {
    const main = Math.max(...[...schedule.get(4)!.values()].filter((at) => et(at) === "Sun 1:00 PM"));
    expect(dueKickoff(schedule, main - 70 * min)).toBeNull();
  });
});
