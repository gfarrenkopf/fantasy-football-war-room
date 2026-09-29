import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { createScoreboardSource } = await import("./scoreboard");

const body = (state: string) => ({ events: [{ status: { type: { state, shortDetail: state } }, competitions: [{ competitors: [{ team: { id: "9" } }] }] }] });
const ok = (state: string) => new Response(JSON.stringify(body(state)), { status: 200 });

function setup(responses: (() => Response)[]) {
  let t = 0;
  const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift()!());
  const source = createScoreboardSource({ fetchImpl, now: () => t, ttlMs: 1000 });
  return { source, fetchImpl, advance: (ms: number) => (t += ms) };
}

describe("createScoreboardSource", () => {
  it("fetches the week's scoreboard, then serves it from cache until it's a minute old", async () => {
    const { source, fetchImpl, advance } = setup([() => ok("pre"), () => ok("in")]);
    expect((await source({ season: 2026, week: 4 })).get("GB")?.state).toBe("pre");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("scoreboard?dates=2026&seasontype=2&week=4");
    advance(999);
    expect((await source({ season: 2026, week: 4 })).get("GB")?.state).toBe("pre");
    advance(1);
    expect((await source({ season: 2026, week: 4 })).get("GB")?.state).toBe("in");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("skips the cache on a refresh", async () => {
    const { source, fetchImpl } = setup([() => ok("pre"), () => ok("in")]);
    await source({ season: 2026, week: 4 });
    expect((await source({ season: 2026, week: 4, maxAgeMs: 0 })).get("GB")?.state).toBe("in");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("serves the last good read when ESPN fails, and an empty scoreboard with none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { source } = setup([() => ok("in"), () => new Response("", { status: 503 }), () => new Response("", { status: 503 })]);
    await source({ season: 2026, week: 4 });
    expect((await source({ season: 2026, week: 4, maxAgeMs: 0 })).get("GB")?.state).toBe("in");
    expect((await source({ season: 2026, week: 5 })).size).toBe(0);
    warn.mockRestore();
  });
});
