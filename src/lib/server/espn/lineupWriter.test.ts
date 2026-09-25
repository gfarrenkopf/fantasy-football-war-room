import { describe, expect, it, vi } from "vitest";
import { writeEspnLineup, type EspnLineupWrite } from "./lineupWriter";

vi.mock("server-only", () => ({}));

const login = { espnS2: "secret-s2", swid: "{ABC}" };
const write: EspnLineupWrite = { season: 2026, espnLeagueId: "704343562", teamId: 1, week: 4, items: [{ playerId: 7, type: "LINEUP", fromLineupSlotId: 20, toLineupSlotId: 2 }] };

function answering(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("writeEspnLineup", () => {
  it("posts one ROSTER transaction for the team and week, with the login as cookies", async () => {
    const { fetchImpl, calls } = answering(200);
    expect(await writeEspnLineup(login, write, { fetchImpl })).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/704343562/transactions/");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Cookie).toBe("espn_s2=secret-s2; SWID={ABC}");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      isLeagueManager: false,
      teamId: 1,
      type: "ROSTER",
      memberId: "{ABC}",
      scoringPeriodId: 4,
      executionType: "EXECUTE",
      items: write.items,
    });
  });

  it("reads ESPN's 409 details", async () => {
    const { fetchImpl } = answering(409, { details: [{ type: "TRAN_ROSTER_SAME_SLOT", message: "X is already in the BE slot" }] });
    expect(await writeEspnLineup(login, write, { fetchImpl })).toEqual({
      ok: false,
      reason: "refused",
      detail: "HTTP 409 TRAN_ROSTER_SAME_SLOT",
      errors: [{ type: "TRAN_ROSTER_SAME_SLOT", message: "X is already in the BE slot" }],
    });
  });

  it("tells a refused login from ESPN being down", async () => {
    expect(await writeEspnLineup(login, write, answering(401))).toMatchObject({ ok: false, reason: "auth" });
    expect(await writeEspnLineup(login, write, answering(503))).toEqual({ ok: false, reason: "unavailable", detail: "HTTP 503" });
    const thrown = (async () => {
      throw Object.assign(new Error("slow"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    expect(await writeEspnLineup(login, write, { fetchImpl: thrown, timeoutMs: 1000 })).toEqual({ ok: false, reason: "unavailable", detail: "timed out after 1s" });
  });
});
