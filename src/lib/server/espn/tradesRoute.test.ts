import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { agreeToWrites, writeConsent } from "../seasonPrefs";
import { createTestLeague } from "../testLeagues";
import type { GuardedOutcome } from "./guardedWrite";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { userId: string; email: string | null } | null,
  outcome: null as unknown,
  calls: 0,
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/trades", () => {
  const run = async () => {
    state.calls++;
    return state.outcome;
  };
  return { proposeTrade: run, respondToTrade: run };
});

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
  return (await import("@/app/api/leagues/[id]/season/trades/route")).POST;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: Record<string, unknown>) =>
  new Request(`http://localhost/api/leagues/${id}/season/trades`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week: 4, ...body }) });
const SNAPSHOT = [{ playerId: 1, slot: "BN" }];
const PROPOSE = { kind: "propose", snapshot: SNAPSHOT, partner: 2, gives: [1], gets: [22], drops: [] };

describe("POST /api/leagues/:id/season/trades", () => {
  let userId: string;
  let leagueId: string;
  let errors: string[];
  beforeEach(async () => {
    vi.resetModules();
    state.outcome = { kind: "applied", landed: { pending: true } } satisfies GuardedOutcome<{ pending: boolean }>;
    state.calls = 0;
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

  it("asks for consent first, then proposes", async () => {
    const POST = await route();
    expect((await POST(post(leagueId, PROPOSE), ctx(leagueId))).status).toBe(409);
    expect(state.calls).toBe(0);
    const res = await POST(post(leagueId, { ...PROPOSE, consentVersion: ESPN_WRITE_VERSION }), ctx(leagueId));
    expect(await res.json()).toEqual({ pending: true });
    expect(await writeConsent(db, userId)).toBe(ESPN_WRITE_VERSION);
  });

  it("answers offers by id, and refuses bad bodies", async () => {
    const POST = await route();
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.outcome = { kind: "applied", landed: { done: true } } satisfies GuardedOutcome<{ done: boolean }>;
    for (const kind of ["decline", "withdraw"]) expect(await (await POST(post(leagueId, { kind, tradeId: "t1" }), ctx(leagueId))).json()).toEqual({ done: true });
    expect((await POST(post(leagueId, { kind: "accept", tradeId: "t1", snapshot: SNAPSHOT }), ctx(leagueId))).status).toBe(200);
    for (const bad of [{ kind: "accept", tradeId: "t1" }, { kind: "veto", tradeId: "t1" }, { kind: "decline", tradeId: "../x" }, { ...PROPOSE, gives: ["1"] }]) {
      expect((await POST(post(leagueId, bad), ctx(leagueId))).status).toBe(400);
    }
    expect(state.calls).toBe(3);
  });

  it("logs a response that didn't land", async () => {
    const POST = await route();
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.outcome = { kind: "applied", landed: { done: false } } satisfies GuardedOutcome<{ done: boolean }>;
    await POST(post(leagueId, { kind: "decline", tradeId: "t1" }), ctx(leagueId));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("trade decline didn't land");
  });
});
