import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { agreeToWrites, writeConsent } from "../seasonPrefs";
import { createTestLeague } from "../testLeagues";
import type { AcquireLanded } from "./acquire";
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
vi.mock("@/lib/server/espn/acquire", () => ({
  addFreeAgent: async () => {
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
  return (await import("@/app/api/leagues/[id]/season/acquire/route")).POST;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, extra: Record<string, unknown> = {}) =>
  new Request(`http://localhost/api/leagues/${id}/season/acquire`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "add", week: 4, snapshot: [{ playerId: 1, slot: "BN" }], add: 99, drop: 1, ...extra }),
  });

type Outcome = GuardedOutcome<AcquireLanded>;

describe("POST /api/leagues/:id/season/acquire", () => {
  let userId: string;
  let leagueId: string;
  let errors: string[];
  beforeEach(async () => {
    vi.resetModules();
    state.outcome = { kind: "applied", landed: { added: true, dropped: true } } satisfies Outcome;
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

  it("asks for the same consent as lineup writes, then adds", async () => {
    const POST = await route();
    const first = await POST(post(leagueId), ctx(leagueId));
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ consent: { version: ESPN_WRITE_VERSION } });
    expect(state.calls).toBe(0);

    const agreed = await POST(post(leagueId, { consentVersion: ESPN_WRITE_VERSION }), ctx(leagueId));
    expect(agreed.status).toBe(200);
    expect(await agreed.json()).toEqual({ added: true, dropped: true });
    expect(await writeConsent(db, userId)).toBe(ESPN_WRITE_VERSION);
    expect(errors).toEqual([]);
  });

  it("refuses bad bodies", async () => {
    const POST = await route();
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    for (const bad of [{ kind: "drop" }, { add: "99" }, { drop: "none" }, { snapshot: [{ playerId: 1, slot: "PK" }] }]) {
      expect((await POST(post(leagueId, bad), ctx(leagueId))).status).toBe(400);
    }
    expect(state.calls).toBe(0);
  });

  it("answers refusals, and logs an add that didn't land", async () => {
    const POST = await route();
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.outcome = { kind: "espn-refused", errors: [{ type: "TRAN_PLAYER_NOT_FREEAGENT", message: "X is not a free agent" }], detail: "HTTP 409" } satisfies Outcome;
    const refused = await POST(post(leagueId), ctx(leagueId));
    expect(refused.status).toBe(409);
    expect((await refused.json()).refused[0]).toContain("isn't a free agent");

    state.outcome = { kind: "applied", landed: { added: false, dropped: true } } satisfies Outcome;
    expect((await POST(post(leagueId), ctx(leagueId))).status).toBe(200);
    expect(errors).toHaveLength(2);
    expect(errors[1]).toContain("free-agent add didn't land");
  });
});
