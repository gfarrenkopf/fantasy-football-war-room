import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_LINEUP_WRITE_VERSION } from "@/lib/espn/disclosure";
import { lineupWriteConsent } from "../seasonPrefs";
import { createTestLeague } from "../testLeagues";
import type { LineupMove } from "@/lib/season/lineup";
import type { ApplyOutcome } from "./applyLineup";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { userId: string; email: string | null } | null,
  outcome: null as unknown,
  calls: 0,
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/applyLineup", () => ({
  applyLineup: async () => {
    state.calls++;
    return state.outcome;
  },
}));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

async function route() {
  const vars = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"), ESPN_SYNC_ALLOWLIST: "" };
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return (await import("@/app/api/leagues/[id]/season/apply/route")).POST;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const MOVES: LineupMove[] = [
  { playerId: 1, from: "BN", to: "RB" },
  { playerId: 2, from: "RB", to: "BN" },
];
const post = (id: string, extra: Record<string, unknown> = {}) =>
  new Request(`http://localhost/api/leagues/${id}/season/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ week: 4, snapshot: [{ playerId: 1, slot: "BN" }, { playerId: 2, slot: "RB" }], moves: MOVES, ...extra }),
  });

describe("POST /api/leagues/:id/season/apply", () => {
  let userId: string;
  let leagueId: string;
  let errors: string[];
  beforeEach(async () => {
    vi.resetModules();
    state.calls = 0;
    state.outcome = { kind: "applied", moves: MOVES.map((m) => ({ ...m, landed: true })) } satisfies ApplyOutcome;
    userId = await createTestUser(db);
    state.user = { userId, email: "fan@example.test" };
    leagueId = await createTestLeague(db, userId);
    errors = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("asks for consent the first time, records it when given, and doesn't ask again", async () => {
    const POST = await route();
    const first = await POST(post(leagueId), ctx(leagueId));
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ consent: { version: ESPN_LINEUP_WRITE_VERSION, lines: expect.arrayContaining([expect.stringContaining("when you press Apply")]) } });
    expect(state.calls).toBe(0);

    const agreed = await POST(post(leagueId, { consentVersion: ESPN_LINEUP_WRITE_VERSION }), ctx(leagueId));
    expect(agreed.status).toBe(200);
    expect(await agreed.json()).toEqual({ moves: MOVES.map((m) => ({ ...m, landed: true })) });
    expect(await lineupWriteConsent(db, userId)).toBe(ESPN_LINEUP_WRITE_VERSION);

    expect((await POST(post(leagueId), ctx(leagueId))).status).toBe(200);
    expect(state.calls).toBe(2);
    expect(errors).toEqual([]);
  });

  it("refuses bad bodies, other users' leagues and cross-origin posts", async () => {
    const POST = await route();
    const bad = new Request(`http://localhost/api/leagues/${leagueId}/season/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week: 4, snapshot: [], moves: [{ playerId: 1, from: "BN", to: "PK" }] }) });
    expect((await POST(bad, ctx(leagueId))).status).toBe(400);
    expect((await POST(post("not-mine", { consentVersion: 1 }), ctx("not-mine"))).status).toBe(404);
    const foreign = new Request(`http://localhost/api/leagues/${leagueId}/season/apply`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
    expect((await POST(foreign, ctx(leagueId))).status).toBe(403);
    expect(state.calls).toBe(0);
  });

  it("answers aborts with what changed, and logs ESPN refusals and moves that didn't land", async () => {
    const POST = await route();
    const send = () => POST(post(leagueId, { consentVersion: ESPN_LINEUP_WRITE_VERSION }), ctx(leagueId));

    state.outcome = { kind: "changed", changes: ["Rb One moved from RB to the bench."] } satisfies ApplyOutcome;
    const changed = await send();
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ changed: ["Rb One moved from RB to the bench."] });

    state.outcome = { kind: "refused", problems: ["Rb One's game has started, so ESPN won't move them this week."] } satisfies ApplyOutcome;
    expect(await (await send()).json()).toMatchObject({ problems: ["Rb One's game has started, so ESPN won't move them this week."] });
    expect(errors).toEqual([]);

    state.outcome = { kind: "espn-refused", errors: [{ type: "TRAN_ROSTER_SAME_SLOT", message: "X is already in the BE slot" }], detail: "HTTP 409 TRAN_ROSTER_SAME_SLOT" } satisfies ApplyOutcome;
    const refused = await send();
    expect(refused.status).toBe(409);
    expect((await refused.json()).refused[0]).toContain("X is already in the BE slot");

    state.outcome = { kind: "applied", moves: [{ ...MOVES[0], landed: true }, { ...MOVES[1], landed: false }] } as ApplyOutcome;
    expect((await send()).status).toBe(200);

    state.outcome = { kind: "unverified", moves: [], detail: "re-read failed" } as ApplyOutcome;
    expect((await send()).status).toBe(502);

    expect(errors).toHaveLength(3);
    expect(errors.every((line) => line.startsWith("[server-error] "))).toBe(true);
    expect(errors[1]).toContain("1 of 2 moves didn't land");
  });
});
