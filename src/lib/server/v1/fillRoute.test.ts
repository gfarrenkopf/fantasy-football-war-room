import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import projections from "@/lib/season/__fixtures__/espn-projections-2026.json";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { snapshotOf } from "@/lib/season/apply";
import { parseSeasonLeague } from "@/lib/season/espnLeague";
import type { Fill, Hole, PoolPlayer } from "@/lib/season/holes";
import type { LineupMove } from "@/lib/season/lineup";
import { parseProjections } from "@/lib/season/projections";
import { buildSeasonView, type SeasonView } from "@/lib/season/view";
import { agreeToWrites } from "../seasonPrefs";
import { createTestLeague } from "../testLeagues";
import type { FillApplied, FillDryRun } from "./team";

vi.mock("server-only", () => ({}));
type Sent = { kind: string; request: { moves?: LineupMove[]; add?: number; drop?: number | null; snapshot?: unknown } };
const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { userId: string; email: string | null } | null,
  load: null as unknown,
  fills: null as unknown,
  /** What ESPN does with each write, in turn: a function of the request. */
  espn: [] as ((request: never) => unknown)[],
  sent: [] as { kind: string; request: unknown }[],
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/seasonView", () => ({ loadSeasonView: async () => state.load }));
vi.mock("@/lib/server/espn/waivers", () => ({ loadFills: async () => state.fills, forgetWaivers: () => {}, pooledPlayer: () => null }));
const write = vi.hoisted(() => (kind: string) => async (_db: unknown, _key: unknown, _userId: unknown, _leagueId: unknown, request: never) => {
  state.sent.push({ kind, request });
  const next = state.espn.shift();
  if (!next) throw new Error(`No ESPN answer for the ${kind}`);
  return next(request);
});
vi.mock("@/lib/server/espn/applyLineup", () => ({ applyLineup: write("apply") }));
vi.mock("@/lib/server/espn/acquire", () => ({ addFreeAgent: write("add"), claimWaiver: write("claim"), cancelClaim: write("cancel") }));

const parsed = parseSeasonLeague(league, "110222051");
if (!parsed.ok) throw new Error(parsed.error);
const base = buildSeasonView(parsed.league, 1, new Map(parseProjections(projections, 2026).map((p) => [p.id, p])));
const mine = base.teams.find((t) => t.id === base.myTeamId)!.roster;
const qb = mine.find((p) => p.slot === "QB")!;
/** The user's QB is out, with an IR spot open. */
const roster = mine.map((p) => (p.playerId === qb.playerId ? { ...p, injuryStatus: "OUT" } : p));
const view: SeasonView = {
  ...base,
  irSlots: mine.filter((p) => p.slot === "IR").length + 1,
  teams: base.teams.map((t) => (t.id === base.myTeamId ? { ...t, roster } : t)),
};
const AGENT: PoolPlayer = { ...qb, playerId: 9001, name: "Wire QB", team: "SEA", slot: "BN", injuryStatus: "ACTIVE", points: 17, status: "FREEAGENT", waiverClears: null };
const HOLE: Hole = { key: "QB", kind: "hard", reason: "out", playerId: qb.playerId, kickoff: null };
const FILL: Fill = { player: AGENT, drop: null, ir: qb.playerId };

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const ENV = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"), ESPN_SYNC_ALLOWLIST: "" };

type Post = { POST: (request: Request, ctx: unknown) => Promise<Response> };
async function route(): Promise<Post> {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return (await import("@/app/api/v1/leagues/[id]/team/fill/route")) as unknown as Post;
}
const ctx = (leagueId: string) => ({ params: Promise.resolve({ id: leagueId }) });
const BODY = { week: view.currentWeek, season: view.season, snapshot: snapshotOf(roster), hole: { key: "QB", playerId: qb.playerId }, add: AGENT.playerId };
const post = (leagueId: string, body: Record<string, unknown> = BODY, query = "") =>
  new Request(`http://localhost/api/v1/leagues/${leagueId}/team/fill${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** ESPN takes a lineup write, and the re-read shows every move. */
const moved = (request: { moves: LineupMove[] }) => ({ kind: "applied", moves: request.moves.map((m) => ({ ...m, landed: true })) });
const added = () => ({ kind: "applied", landed: { added: true, dropped: true } });

let userId: string;
let leagueId: string;
let errors: string[];
beforeEach(async () => {
  state.sent = [];
  state.espn = [];
  state.load = { kind: "ok", view, fetchedAt: new Date("2026-09-20T16:00:00Z"), stale: false, projectionsMissing: false, phase: "lineup" };
  state.fills = { kind: "ok", holes: [HOLE], fills: [{ hole: HOLE, fills: [FILL], claims: [] }] };
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

describe("POST /api/v1/leagues/:id/team/fill", () => {
  it("answers a dry run with each step in words, needing no consent and writing nothing", async () => {
    const res = await (await route()).POST(post(leagueId, BODY, "?dryRun=1"), ctx(leagueId));
    expect(res.status).toBe(200);
    expect((await res.json()) as FillDryRun).toEqual({
      text: "Fill your QB hole with Wire QB.",
      steps: [`Move ${qb.name} to IR`, "Add Wire QB", "Start Wire QB at QB"],
      problems: [],
    });
    expect(state.sent).toEqual([]);
  });

  it("asks for the consent before writing", async () => {
    const res = await (await route()).POST(post(leagueId), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ consent: { version: ESPN_WRITE_VERSION } });
    expect(state.sent).toEqual([]);
  });

  it("moves the hole's player to IR, adds the fill, then starts him, each against the roster the last left", async () => {
    state.espn = [moved, added, moved];
    const res = await (await route()).POST(post(leagueId, { ...BODY, consentVersion: ESPN_WRITE_VERSION }), ctx(leagueId));
    expect(res.status).toBe(200);
    expect((await res.json()) as FillApplied).toEqual({
      landed: true,
      result: "Done. Wire QB starts at QB.",
      steps: [
        { text: `Move ${qb.name} to IR`, landed: true },
        { text: "Add Wire QB", landed: true },
        { text: "Start Wire QB at QB", landed: true },
      ],
      details: [],
    });
    const sent = state.sent as Sent[];
    expect(sent.map((s) => s.kind)).toEqual(["apply", "add", "apply"]);
    expect(sent[0].request.moves).toEqual([{ playerId: qb.playerId, from: "QB", to: "IR" }]);
    expect(sent[1].request).toMatchObject({ add: AGENT.playerId, drop: null, snapshot: expect.arrayContaining([{ playerId: qb.playerId, slot: "IR" }]) });
    expect(sent[2].request.moves).toEqual([{ playerId: AGENT.playerId, from: "BN", to: "QB" }]);
    expect(sent[2].request.snapshot).toContainEqual({ playerId: AGENT.playerId, slot: "BN" });
  });

  it("stops halfway when ESPN refuses the add, and says the IR move landed", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.espn = [moved, () => ({ kind: "espn-refused", errors: [{ type: "TRAN_PLAYER_NOT_FREE_AGENT", message: "" }], detail: "not a free agent" })];
    const res = await (await route()).POST(post(leagueId), ctx(leagueId));
    expect(res.status).toBe(200);
    const out = (await res.json()) as FillApplied;
    expect(out).toMatchObject({
      landed: false,
      result: `ESPN didn't add Wire QB. ${qb.name} is on IR now.`,
      steps: [
        { text: `Move ${qb.name} to IR`, landed: true },
        { text: "Add Wire QB", landed: false },
        { text: "Start Wire QB at QB", landed: null },
      ],
    });
    expect(out.details).toHaveLength(1);
    expect(state.sent.map((s) => s.kind)).toEqual(["apply", "add"]);
    expect(errors.some((e) => e.includes("ESPN refused a hole fill add"))).toBe(true);
  });

  it("answers as any write when the first step doesn't go, and nothing else is sent", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.espn = [() => ({ kind: "changed", changes: ["Lamar is on the bench now."] })];
    const res = await (await route()).POST(post(leagueId), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ changed: ["Lamar is on the bench now."] });
    expect(state.sent.map((s) => s.kind)).toEqual(["apply"]);
  });

  it("says when the player was added but ESPN refused to start him", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.espn = [moved, added, () => ({ kind: "espn-refused", errors: [{ type: "TRAN_PLAYER_LOCKED", message: "Locked" }], detail: "HTTP 409" })];
    const out = (await (await (await route()).POST(post(leagueId), ctx(leagueId))).json()) as FillApplied;
    expect(out).toMatchObject({ landed: false, result: "Wire QB is on your team, but ESPN didn't start him at QB. Start him from your lineup." });
    expect(out.steps.map((s) => s.landed)).toEqual([true, true, false]);
  });

  it("says when ESPN took the start but doesn't show it yet (APE-444)", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.espn = [moved, added, (request: { moves: LineupMove[] }) => ({ kind: "applied", moves: request.moves.map((m) => ({ ...m, landed: false })) })];
    const out = (await (await (await route()).POST(post(leagueId), ctx(leagueId))).json()) as FillApplied;
    expect(out).toMatchObject({ landed: false, result: "Wire QB is on your team. ESPN took the change to start him at QB but doesn't show it yet. Check your lineup in a minute.", details: [] });
    expect(out.steps.map((s) => s.landed)).toEqual([true, true, false]);
  });

  it("refuses a fill that's no longer on offer, and a roster that changed since staging", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    const gone = await (await route()).POST(post(leagueId, { ...BODY, add: 4242 }), ctx(leagueId));
    expect(gone.status).toBe(409);
    expect(await gone.json()).toMatchObject({ changed: ["The ways to fill this hole have changed. Look again and pick one."] });
    const stale = await (await route()).POST(post(leagueId, { ...BODY, snapshot: snapshotOf(roster).slice(1) }), ctx(leagueId));
    expect(stale.status).toBe(409);
    expect(state.sent).toEqual([]);
  });

  it("400s a body that isn't a fill", async () => {
    expect((await (await route()).POST(post(leagueId, { ...BODY, hole: { key: "XX", playerId: null } }), ctx(leagueId))).status).toBe(400);
  });
});
