import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { readEspnLeague } = await import("./leagueReader");

const LOGIN = { espnS2: "AEB%2Fnot-real", swid: "{154E132F-8C13-4AC0-9DAC-20C2C5625594}" };
const query = { season: 2026, espnLeagueId: "862962874", views: ["mRoster"] };

/** A response whose body arrives after `ms`, like ESPN's multi-megabyte league document on a slow day. */
function slowBody(ms: number, body = "{}") {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const stream = new ReadableStream({
      start(controller) {
        const timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        }, ms);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          controller.error(init.signal!.reason);
        });
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
  });
}

describe("readEspnLeague", () => {
  it("reads a slow body within the timeout", async () => {
    expect(await readEspnLeague(LOGIN, query, { fetchImpl: slowBody(50, '{"id":1}'), timeoutMs: 1000 })).toEqual({ ok: true, data: { id: 1 } });
  });

  it("calls a body that doesn't arrive in time a timeout, not a bad response", async () => {
    const read = await readEspnLeague(LOGIN, query, { fetchImpl: slowBody(1000), timeoutMs: 50 });
    expect(read).toEqual({ ok: false, reason: "unavailable", detail: expect.stringContaining("timed out") });
  });

  it("says when ESPN really does send something that isn't JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await readEspnLeague(LOGIN, query, { fetchImpl })).toEqual({ ok: false, reason: "unavailable", detail: "not JSON (text/html)" });
  });

  it("maps ESPN's refusals", async () => {
    const status = (code: number) => vi.fn<typeof fetch>(async () => new Response("{}", { status: code }));
    expect(await readEspnLeague(LOGIN, query, { fetchImpl: status(401) })).toMatchObject({ ok: false, reason: "auth" });
    expect(await readEspnLeague(LOGIN, query, { fetchImpl: status(403) })).toMatchObject({ ok: false, reason: "auth" });
    expect(await readEspnLeague(LOGIN, query, { fetchImpl: status(404) })).toMatchObject({ ok: false, reason: "not-found" });
    expect(await readEspnLeague(LOGIN, query, { fetchImpl: status(500) })).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
