import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import projections from "@/lib/season/__fixtures__/espn-projections-2026.json";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { seatsFromRoster, snapshotOf, starterSeats } from "@/lib/season/apply";
import { parseSeasonLeague } from "@/lib/season/espnLeague";
import type { LineupMove } from "@/lib/season/lineup";
import { parseProjections } from "@/lib/season/projections";
import { buildSeasonView, type SeasonView } from "@/lib/season/view";
import type { ApplyOutcome, ApplyRequest } from "../espn/applyLineup";
import { listLineupMoves } from "../lineupMoves";
import { agreeToWrites, writeConsent } from "../seasonPrefs";
import { createTestLeague } from "../testLeagues";
import type { LineupApplied, LineupDryRun } from "./lineup";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { userId: string; email: string | null } | null,
  load: null as unknown,
  outcome: null as ((request: ApplyRequest) => unknown) | null,
  sent: [] as ApplyRequest[],
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/seasonView", () => ({ loadSeasonView: async () => state.load }));
vi.mock("@/lib/server/espn/applyLineup", () => ({
  applyLineup: async (_db: unknown, _key: unknown, _userId: unknown, _leagueId: unknown, request: ApplyRequest) => {
    state.sent.push(request);
    return state.outcome!(request);
  },
}));

const parsed = parseSeasonLeague(league, "110222051");
if (!parsed.ok) throw new Error(parsed.error);
const base = buildSeasonView(parsed.league, 1, new Map(parseProjections(projections, 2026).map((p) => [p.id, p])));
const roster = base.teams.find((t) => t.id === base.myTeamId)!.roster;
const id = (name: string) => roster.find((p) => p.name === name)!.playerId;
const onEspn = seatsFromRoster(roster, starterSeats(base.starters));
// War Room starts Javonte Williams over James Cook (seat 2).
const view: SeasonView = { ...base, lineup: { ...base.lineup, starters: base.lineup.starters.map((f, i) => (i === 2 ? { ...f, playerId: id("Javonte Williams") } : f)) } };
const withLocked = (name: string): SeasonView => ({
  ...view,
  teams: view.teams.map((t) => (t.id === view.myTeamId ? { ...t, roster: t.roster.map((p) => (p.name === name ? { ...p, locked: true } : p)) } : t)),
});
/** The user's target: War Room's RB swap, plus McLaurin for London at WR on their own. */
const LINEUP = onEspn.map((p, i) => (i === 2 ? id("Javonte Williams") : i === 4 ? id("Terry McLaurin") : p));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const ENV = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"), ESPN_SYNC_ALLOWLIST: "" };

async function stub(env: Partial<typeof ENV> = {}) {
  for (const [name, value] of Object.entries({ ...ENV, ...env })) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
}
async function route(env: Partial<typeof ENV> = {}) {
  await stub(env);
  return (await import("@/app/api/v1/leagues/[id]/lineup/route")).POST;
}
async function consentRoute(env: Partial<typeof ENV> = {}) {
  await stub(env);
  return (await import("@/app/api/v1/espn/write-consent/route")).POST;
}

const ctx = (leagueId: string) => ({ params: Promise.resolve({ id: leagueId }) });
const body = (extra: Record<string, unknown> = {}) => ({ week: view.currentWeek, season: view.season, snapshot: snapshotOf(roster), lineup: LINEUP, ...extra });
const post = (leagueId: string, extra: Record<string, unknown> = {}, query = "", headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/v1/leagues/${leagueId}/lineup${query}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body(extra)) });
const consent = (version: unknown) => new Request("http://localhost/api/v1/espn/write-consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }) });

const landedAll = (request: ApplyRequest): ApplyOutcome => ({ kind: "applied", moves: request.moves.map((m) => ({ ...m, landed: true })) });

describe("POST /api/v1/leagues/:id/lineup", () => {
  let userId: string;
  let leagueId: string;
  let errors: string[];
  beforeEach(async () => {
    vi.resetModules();
    state.sent = [];
    state.load = { kind: "ok", view, fetchedAt: new Date("2026-09-20T16:00:00Z"), stale: false, projectionsMissing: false, phase: "lineup" };
    state.outcome = landedAll;
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

  it("dry-runs: lists each change in plain words with an id, with no consent and no write", async () => {
    const POST = await route();
    const res = await POST(post(leagueId, {}, "?dryRun=1"), ctx(leagueId));
    expect(res.status).toBe(200);
    const out = (await res.json()) as LineupDryRun;
    expect(out.problems).toEqual([]);
    expect(out.changes.map((c) => [c.text, c.picked])).toEqual(
      expect.arrayContaining([
        ["Start Javonte Williams at RB, bench James Cook III", true],
        ["Start Terry McLaurin at WR, bench Drake London", true],
      ]),
    );
    expect(out.changes.every((c) => /^\d+:\w+(,-?\d+:\w+)*$/.test(c.id))).toBe(true);
    expect(state.sent).toEqual([]);
    expect(await writeConsent(db, userId)).toBeNull();
  });

  it("dry-runs the problems: a locked player", async () => {
    state.load = { ...(state.load as object), view: withLocked("James Cook III") };
    const POST = await route();
    const out = (await (await POST(post(leagueId, {}, "?dryRun=1"), ctx(leagueId))).json()) as LineupDryRun;
    expect(out.problems).toEqual(["James Cook III's game has started, so ESPN won't move them this week."]);
  });

  it("asks for consent before writing, and again when the user agreed to an older version", async () => {
    const POST = await route();
    const res = await POST(post(leagueId), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ consent: { version: ESPN_WRITE_VERSION, lines: expect.any(Array) } });
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION - 1);
    expect((await POST(post(leagueId), ctx(leagueId))).status).toBe(409);
    expect(state.sent).toEqual([]);
  });

  it("applies the picked changes and says each landed, keeping War Room's moves", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    const POST = await route();
    const res = await POST(post(leagueId), ctx(leagueId));
    expect(res.status).toBe(200);
    const out = (await res.json()) as LineupApplied;
    expect(out.changes).toHaveLength(2);
    expect(out.changes.every((c) => c.landed && c.result === "Done on ESPN.")).toBe(true);
    // War Room's move leads the Lock In moment; the user's own is their call.
    expect(out.lockIn).toMatchObject({
      headline: expect.any(String),
      moves: [
        { playerId: id("Javonte Williams"), text: "Javonte Williams in at RB", own: false },
        { playerId: id("Terry McLaurin"), text: "Terry McLaurin in at WR", own: true },
      ],
    });
    expect(out.lockIn!.after).toBeCloseTo(out.lockIn!.before + out.lockIn!.moves.reduce((sum, m) => sum + m.gain, 0), 1);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ week: view.currentWeek, snapshot: snapshotOf(roster) });
    expect(state.sent[0].moves).toHaveLength(4);
    expect(await listLineupMoves(db, leagueId, view.season, view.currentWeek)).toEqual([{ playerId: id("Javonte Williams"), slot: "RB", gain: expect.any(Number) }]);
    expect(errors).toEqual([]);
  });

  it("sends only the changes left ticked", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    const POST = await route();
    const dry = (await (await POST(post(leagueId, {}, "?dryRun=1"), ctx(leagueId))).json()) as LineupDryRun;
    const wr = dry.changes.find((c) => c.text.includes("McLaurin"))!;
    const out = (await (await POST(post(leagueId, { changes: [wr.id] }), ctx(leagueId))).json()) as LineupApplied;
    expect(out.changes.map((c) => c.id)).toEqual([wr.id]);
    expect(state.sent[0].moves).toEqual(wr.moves);
    expect(await listLineupMoves(db, leagueId, view.season, view.currentWeek)).toEqual([]);
  });

  it("says which changes didn't land, and alerts", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.outcome = (request) => ({ kind: "applied", moves: request.moves.map((m: LineupMove) => ({ ...m, landed: m.playerId !== id("Drake London") })) });
    const POST = await route();
    const out = (await (await POST(post(leagueId), ctx(leagueId))).json()) as LineupApplied;
    const wr = out.changes.find((c) => c.text.includes("McLaurin"))!;
    expect(wr).toMatchObject({ landed: false, result: "Only part of this landed on ESPN: Drake London didn't move. Check it there." });
    expect(out.changes.find((c) => c !== wr)).toMatchObject({ landed: true });
    expect(out.lockIn).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("1 of 4 moves didn't land");
  });

  it("refuses a locked player without writing", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.load = { ...(state.load as object), view: withLocked("James Cook III") };
    const POST = await route();
    const res = await POST(post(leagueId), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ problems: ["James Cook III's game has started, so ESPN won't move them this week."] });
    expect(state.sent).toEqual([]);
  });

  it("refuses a lineup with nothing to change, and stops when ESPN changed since staging", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    const POST = await route();
    expect(await (await POST(post(leagueId, { lineup: onEspn }), ctx(leagueId))).json()).toMatchObject({ problems: ["There's nothing to change."] });
    const moved = snapshotOf(roster).map((p) => (p.playerId === id("Javonte Williams") ? { ...p, slot: "RB" } : p));
    expect(await (await POST(post(leagueId, { snapshot: moved }), ctx(leagueId))).json()).toMatchObject({ changed: ["Javonte Williams moved from RB to the bench."] });
    expect(await (await POST(post(leagueId, { week: view.currentWeek - 1 }), ctx(leagueId))).json()).toMatchObject({ changed: [`ESPN has moved on to week ${view.currentWeek}.`] });
    state.load = { kind: "disconnected" };
    expect(await (await POST(post(leagueId), ctx(leagueId))).json()).toMatchObject({ problem: "disconnected" });
    expect(state.sent).toEqual([]);
  });

  it("answers ESPN refusing and an unverified write as the web does", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    const POST = await route();
    state.outcome = () => ({ kind: "espn-refused", errors: [{ type: "TRAN_LINEUP_LOCKED", message: "Locked" }], detail: "HTTP 409" });
    const refused = await POST(post(leagueId), ctx(leagueId));
    expect(refused.status).toBe(409);
    expect((await refused.json()).refused[0]).toContain("game has started");
    state.outcome = (request) => ({ kind: "unverified", moves: request.moves, detail: "re-read failed" });
    const unverified = await POST(post(leagueId), ctx(leagueId));
    expect(unverified.status).toBe(502);
    expect(await unverified.json()).toMatchObject({ unverified: true, changes: expect.arrayContaining([expect.objectContaining({ text: "Start Terry McLaurin at WR, bench Drake London" })]) });
  });

  it("refuses bad bodies and change ids that aren't this lineup's", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    const POST = await route();
    expect((await POST(post(leagueId, { lineup: "QB" }), ctx(leagueId))).status).toBe(400);
    expect((await POST(post(leagueId, { season: undefined }), ctx(leagueId))).status).toBe(400);
    expect((await POST(post(leagueId, { lineup: LINEUP.slice(1) }), ctx(leagueId))).status).toBe(400);
    expect((await POST(post(leagueId, { changes: ["1:QB"] }), ctx(leagueId))).status).toBe(400);
    expect(state.sent).toEqual([]);
  });

  it("is gated like the web's apply route", async () => {
    expect((await (await route({ DATABASE_URL: "" }))(post(leagueId), ctx(leagueId))).status).toBe(404);
    vi.unstubAllEnvs();
    vi.resetModules();
    expect((await (await route({ ESPN_CODE_KEY: "" }))(post(leagueId), ctx(leagueId))).status).toBe(404);
    vi.unstubAllEnvs();
    vi.resetModules();
    expect((await (await route({ ESPN_SYNC_ALLOWLIST: "someone@else.test" }))(post(leagueId), ctx(leagueId))).status).toBe(403);
    vi.unstubAllEnvs();
    vi.resetModules();
    const POST = await route();
    expect((await POST(post("not-mine"), ctx("not-mine"))).status).toBe(404);
    expect((await POST(post(leagueId, {}, "", { origin: "https://evil.example" }), ctx(leagueId))).status).toBe(403);
    state.user = null;
    expect((await POST(post(leagueId), ctx(leagueId))).status).toBe(401);
    expect(state.sent).toEqual([]);
  });
});

describe("POST /api/v1/espn/write-consent", () => {
  let userId: string;
  beforeEach(async () => {
    vi.resetModules();
    userId = await createTestUser(db);
    state.user = { userId, email: "fan@example.test" };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("records consent at the current version", async () => {
    const POST = await consentRoute();
    const res = await POST(consent(ESPN_WRITE_VERSION), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: ESPN_WRITE_VERSION, agreed: true });
    expect(await writeConsent(db, userId)).toBe(ESPN_WRITE_VERSION);
  });

  it("answers an outdated version with the current consent, recording nothing", async () => {
    const POST = await consentRoute();
    const res = await POST(consent(ESPN_WRITE_VERSION - 1), {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ consent: { version: ESPN_WRITE_VERSION } });
    expect(await writeConsent(db, userId)).toBeNull();
    expect((await POST(consent("1"), {})).status).toBe(400);
  });

  it("is gated", async () => {
    expect((await (await consentRoute({ ESPN_SYNC_ALLOWLIST: "someone@else.test" }))(consent(ESPN_WRITE_VERSION), {})).status).toBe(403);
    vi.unstubAllEnvs();
    vi.resetModules();
    const POST = await consentRoute();
    state.user = null;
    expect((await POST(consent(ESPN_WRITE_VERSION), {})).status).toBe(401);
  });
});
