import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import league from "@/lib/season/__fixtures__/espn-league-2026.json";
import projections from "@/lib/season/__fixtures__/espn-projections-2026.json";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { ESPN_WRITE_VERSION } from "@/lib/espn/disclosure";
import { FAAB_CLAIMS } from "@/lib/season/acquire";
import { snapshotOf } from "@/lib/season/apply";
import { parseSeasonLeague } from "@/lib/season/espnLeague";
import { parseProjections } from "@/lib/season/projections";
import type { FreeAgent } from "@/lib/season/types";
import { buildSeasonView, type SeasonView } from "@/lib/season/view";
import { agreeToWrites, writeConsent } from "../seasonPrefs";
import { createTestLeague } from "../testLeagues";
import type { PlayersResponse, TeamApplied, TeamDryRun, TradesResponse, WaiversResponse } from "./team";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { userId: string; email: string | null } | null,
  load: null as unknown,
  waivers: null as unknown,
  fills: null as unknown,
  pooled: null as unknown,
  search: null as unknown,
  searched: [] as unknown[],
  outcome: null as unknown,
  sent: [] as { kind: string; request: unknown }[],
}));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/auth", () => ({ getSessionUser: async () => state.user }));
vi.mock("@/lib/server/espn/seasonView", () => ({ loadSeasonView: async () => state.load }));
vi.mock("@/lib/server/espn/waivers", () => ({
  loadWaivers: async () => state.waivers,
  loadFills: async () => state.fills,
  availablePlayer: async () => state.pooled,
  searchPlayers: async (_db: unknown, _key: unknown, _userId: unknown, _leagueId: unknown, search: unknown) => {
    state.searched.push(search);
    return state.search;
  },
  forgetWaivers: () => {},
}));
vi.mock("@/lib/server/espn/acquire", () => {
  const run = (kind: string) => async (_db: unknown, _key: unknown, _userId: unknown, _leagueId: unknown, request: unknown) => {
    state.sent.push({ kind, request });
    return state.outcome;
  };
  return { addFreeAgent: run("add"), claimWaiver: run("claim"), cancelClaim: run("cancel") };
});
vi.mock("@/lib/server/espn/trades", () => {
  const run = (kind: string) => async (_db: unknown, _key: unknown, _userId: unknown, _leagueId: unknown, request: unknown) => {
    state.sent.push({ kind, request });
    return state.outcome;
  };
  return { proposeTrade: run("propose"), respondToTrade: run("respond") };
});

const parsed = parseSeasonLeague(league, "110222051");
if (!parsed.ok) throw new Error(parsed.error);
const base = buildSeasonView(parsed.league, 1, new Map(parseProjections(projections, 2026).map((p) => [p.id, p])));
const roster = base.teams.find((t) => t.id === base.myTeamId)!.roster;
const partner = base.teams.find((t) => t.id === 3)!;
const id = (name: string) => [...roster, ...partner.roster].find((p) => p.name === name)!.playerId;
/** A free agent the app read from the wire. */
const AGENT: FreeAgent = { playerId: 9001, name: "Wire Guy", pos: "WR", team: "SEA", injuryStatus: "ACTIVE", status: "FREEAGENT", waiverClears: null, ownership: null };
const CLAIM = { id: "claim-1", drop: id("Broncos D/ST"), bid: 0, processesAt: "2026-09-23T07:00:00.000Z", add: { playerId: 9002, name: "Claimed Guy", pos: "RB" as const, team: "NYJ" } };
/** An offer from the partner: their Bijan Robinson for the user's Javonte Williams. */
const OFFER = {
  id: "trade-1",
  status: "proposed" as const,
  proposerTeamId: partner.id,
  partnerTeamId: base.myTeamId,
  moves: [
    { playerId: id("Bijan Robinson"), fromTeamId: partner.id, toTeamId: base.myTeamId },
    { playerId: id("Javonte Williams"), fromTeamId: base.myTeamId, toTeamId: partner.id },
  ],
  proposedAt: null,
  expiresAt: null,
  processesAt: null,
};
const view: SeasonView = { ...base, claims: [CLAIM], pendingTrades: [OFFER], waiver: { rank: 4, budget: null, left: null } };
const faab: SeasonView = { ...view, waiver: { rank: null, budget: 100, left: 62 } };

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
  state.db = db;
});
afterAll(() => close());

const ENV = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ESPN_CODE_KEY: Buffer.alloc(32, 7).toString("base64"), ESPN_SYNC_ALLOWLIST: "" };

const ROUTES = {
  waivers: () => import("@/app/api/v1/leagues/[id]/team/waivers/route"),
  fills: () => import("@/app/api/v1/leagues/[id]/team/fills/route"),
  players: () => import("@/app/api/v1/leagues/[id]/team/players/route"),
  acquire: () => import("@/app/api/v1/leagues/[id]/team/acquire/route"),
  trades: () => import("@/app/api/v1/leagues/[id]/team/trades/route"),
};

/** A route module, fresh, with `env` over the defaults. */
async function load<T>(path: keyof typeof ROUTES, env: Partial<typeof ENV> = {}): Promise<T> {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries({ ...ENV, ...env })) vi.stubEnv(name, value);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return (await ROUTES[path]()) as unknown as T;
}
type Get = { GET: (request: Request, ctx: unknown) => Promise<Response> };
type Post = { POST: (request: Request, ctx: unknown) => Promise<Response> };

const ctx = (leagueId: string) => ({ params: Promise.resolve({ id: leagueId }) });
const get = (leagueId: string, path: string) => new Request(`http://localhost/api/v1/leagues/${leagueId}/team/${path}`);
const post = (leagueId: string, path: string, body: Record<string, unknown>, query = "") =>
  new Request(`http://localhost/api/v1/leagues/${leagueId}/team/${path}${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const ADD = { kind: "add", week: view.currentWeek, snapshot: snapshotOf(roster), add: AGENT.playerId, drop: id("Broncos D/ST") };
const CANCEL = { kind: "cancel", week: view.currentWeek, claimId: CLAIM.id };
const ACCEPT = { kind: "accept", week: view.currentWeek, snapshot: snapshotOf(roster), tradeId: OFFER.id };

let userId: string;
let leagueId: string;
let errors: string[];
beforeEach(async () => {
  vi.resetModules();
  state.sent = [];
  state.load = { kind: "ok", view, fetchedAt: new Date("2026-09-20T16:00:00Z"), stale: false, projectionsMissing: false, phase: "lineup" };
  state.waivers = { kind: "ok", view, pickups: [], ahead: [], considered: 100, fetchedAt: new Date("2026-09-20T16:00:00Z") };
  state.fills = { kind: "ok", holes: [], fills: [] };
  state.pooled = AGENT;
  state.search = { kind: "ok", view, players: [], rostered: [], more: false, fetchedAt: new Date("2026-09-20T16:00:00Z") };
  state.searched = [];
  state.outcome = null;
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

describe("the gates every team route shares", () => {
  it("404s with in-season help off, 403s off the allowlist, and 404s someone else's league", async () => {
    expect((await (await load<Get>("waivers", { ESPN_CODE_KEY: "" })).GET(get(leagueId, "waivers"), ctx(leagueId))).status).toBe(404);
    expect((await (await load<Post>("acquire", { ESPN_SYNC_ALLOWLIST: "someone@else.test" })).POST(post(leagueId, "acquire", ADD), ctx(leagueId))).status).toBe(403);
    const other = await createTestLeague(db, await createTestUser(db));
    expect((await (await load<Post>("trades")).POST(post(other, "trades", ACCEPT, "?dryRun=1"), ctx(other))).status).toBe(404);
    state.user = null;
    expect((await (await load<Get>("fills")).GET(get(leagueId, "fills"), ctx(leagueId))).status).toBe(401);
  });
});

describe("GET /api/v1/leagues/:id/team/waivers", () => {
  it("serves the web's wire with the note, whether Draft Room claims here, and who could be dropped", async () => {
    const { GET } = await load<Get>("waivers");
    const res = await GET(get(leagueId, "waivers"), ctx(leagueId));
    expect(res.status).toBe(200);
    const out = (await res.json()) as WaiversResponse;
    expect(out).toMatchObject({ pickups: [], ahead: [], considered: 100, fetchedAt: "2026-09-20T16:00:00.000Z", note: `Waiver priority 4 of ${view.teams.length}`, claims: { allowed: true, reason: null } });
    expect(out.drops.needed).toBe(true);
    expect(out.drops.candidates[0]).toBe(id("Broncos D/ST"));
    expect(out.drops.candidates).not.toContain(roster.find((p) => p.slot === "IR")?.playerId ?? -1);
  });

  it("says a league that bids FAAB claims on ESPN", async () => {
    state.waivers = { ...(state.waivers as object), view: faab };
    const out = (await (await (await load<Get>("waivers")).GET(get(leagueId, "waivers"), ctx(leagueId))).json()) as WaiversResponse;
    expect(out.note).toBe("$62 of $100 FAAB left");
    expect(out.claims).toEqual({ allowed: false, reason: FAAB_CLAIMS });
  });

  it("answers 409 with the problem when ESPN can't be read", async () => {
    state.waivers = { kind: "problem", problem: "no-login" };
    const res = await (await load<Get>("waivers")).GET(get(leagueId, "waivers"), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ problem: "no-login" });
  });
});

describe("GET /api/v1/leagues/:id/team/players", () => {
  const pickup = { player: { ...AGENT, ros: 40, weekly: {} }, delta: 6, perWeek: 2, drop: id("Broncos D/ST") };

  it("searches the pool by name, position and page, and answers a page of valued players", async () => {
    const rostered = [{ player: partner.roster[0], teamId: partner.id, team: partner.name, mine: false }];
    state.search = { ...(state.search as object), players: [pickup], rostered, more: true };
    const res = await (await load<Get>("players")).GET(get(leagueId, "players?q=%20wire%20%20guy&pos=WR&offset=25"), ctx(leagueId));
    expect(res.status).toBe(200);
    expect((await res.json()) as PlayersResponse).toEqual(JSON.parse(JSON.stringify({ players: [pickup], rostered, more: true, fetchedAt: "2026-09-20T16:00:00.000Z" })));
    expect(state.searched).toEqual([{ name: "wire guy", position: "WR", offset: 25, refresh: false }]);
  });

  it("browses without a name, and treats a single letter as no name", async () => {
    await (await load<Get>("players")).GET(get(leagueId, "players?q=w"), ctx(leagueId));
    expect(state.searched).toEqual([{ offset: 0, refresh: false }]);
  });

  it("400s a malformed search before reading ESPN", async () => {
    const { GET } = await load<Get>("players");
    for (const query of ["pos=LB", "offset=-1", "offset=1.5", `q=${"x".repeat(41)}`]) expect((await GET(get(leagueId, `players?${query}`), ctx(leagueId))).status).toBe(400);
    expect(state.searched).toEqual([]);
  });

  it("429s a user searching faster than a minute's worth", async () => {
    const { GET } = await load<Get>("players");
    for (let i = 0; i < 60; i++) expect((await GET(get(leagueId, "players"), ctx(leagueId))).status).toBe(200);
    expect((await GET(get(leagueId, "players"), ctx(leagueId))).status).toBe(429);
  });

  it("answers 409 with the problem when ESPN can't be read", async () => {
    state.search = { kind: "problem", problem: "disconnected" };
    const res = await (await load<Get>("players")).GET(get(leagueId, "players"), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ problem: "disconnected" });
  });
});

describe("GET /api/v1/leagues/:id/team/fills", () => {
  it("passes the web's holes and fills through", async () => {
    state.fills = { kind: "ok", holes: [{ key: "TE", kind: "hard" }], fills: [] };
    const res = await (await load<Get>("fills")).GET(get(leagueId, "fills"), ctx(leagueId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ holes: [{ key: "TE", kind: "hard" }], fills: [] });
  });
});

describe("POST /api/v1/leagues/:id/team/acquire", () => {
  it("dry-runs an add in plain words, with no consent and no write", async () => {
    const { POST } = await load<Post>("acquire");
    const res = await POST(post(leagueId, "acquire", ADD, "?dryRun=1"), ctx(leagueId));
    expect(res.status).toBe(200);
    expect((await res.json()) as TeamDryRun).toEqual({ text: "Add Wire Guy and drop Broncos D/ST.", problems: [] });
    expect(state.sent).toEqual([]);
    expect(await writeConsent(db, userId)).toBeNull();
  });

  it("dry-runs the problems: a full roster with no drop, a player on waivers, a FAAB claim, a cancelled claim", async () => {
    const { POST } = await load<Post>("acquire");
    const dry = async (body: Record<string, unknown>) => (await (await POST(post(leagueId, "acquire", body, "?dryRun=1"), ctx(leagueId))).json()) as TeamDryRun;
    expect((await dry({ ...ADD, drop: null })).problems).toEqual(["Your roster is full at 16 players. Pick someone to drop."]);
    state.pooled = { ...AGENT, status: "WAIVERS" };
    expect((await dry(ADD)).problems).toEqual(["Wire Guy is on waivers. Claim them instead."]);
    expect(await dry({ ...ADD, kind: "claim" })).toEqual({ text: "Claim Wire Guy off waivers, dropping Broncos D/ST if the claim goes through.", problems: [] });
    state.load = { ...(state.load as object), view: faab };
    expect((await dry({ ...ADD, kind: "claim" })).problems).toEqual([FAAB_CLAIMS]);
    expect(await dry(CANCEL)).toEqual({ text: "Cancel your claim for Claimed Guy.", problems: [] });
    expect((await dry({ ...CANCEL, claimId: "gone" })).problems).toEqual(["That claim isn't pending on ESPN any more."]);
  });

  it("dry-runs a roster that changed on ESPN as the write would refuse it", async () => {
    const { POST } = await load<Post>("acquire");
    const res = await POST(post(leagueId, "acquire", { ...ADD, week: view.currentWeek - 1 }, "?dryRun=1"), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ changed: [`ESPN has moved on to week ${view.currentWeek}.`] });
  });

  it("asks for consent before writing", async () => {
    const res = await (await load<Post>("acquire")).POST(post(leagueId, "acquire", ADD), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ consent: { version: ESPN_WRITE_VERSION } });
    expect(state.sent).toEqual([]);
  });

  it("adds through the web's write and says what landed, agreeing to the consent sent with it", async () => {
    state.outcome = { kind: "applied", landed: { added: true, dropped: true } };
    const res = await (await load<Post>("acquire")).POST(post(leagueId, "acquire", { ...ADD, consentVersion: ESPN_WRITE_VERSION }), ctx(leagueId));
    expect(res.status).toBe(200);
    expect((await res.json()) as TeamApplied).toEqual({ added: true, dropped: true, landed: true, result: "Done. Wire Guy is on your team, and Broncos D/ST is gone." });
    expect(state.sent).toEqual([{ kind: "add", request: expect.objectContaining({ add: AGENT.playerId, drop: id("Broncos D/ST"), week: view.currentWeek }) }]);
    expect(await writeConsent(db, userId)).toBe(ESPN_WRITE_VERSION);
  });

  it("says when an add, claim or cancel ESPN took doesn't show, and alerts", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    const { POST } = await load<Post>("acquire");
    state.outcome = { kind: "applied", landed: { added: true, dropped: false } };
    expect(await (await POST(post(leagueId, "acquire", ADD), ctx(leagueId))).json()).toMatchObject({ landed: false, result: "Done. Wire Guy is on your team, but your drop is still on your team." });
    state.outcome = { kind: "applied", landed: { pending: false } };
    expect(await (await POST(post(leagueId, "acquire", { ...ADD, kind: "claim" }), ctx(leagueId))).json()).toMatchObject({
      landed: false,
      result: "ESPN doesn't show your claim for Wire Guy. Check ESPN. Draft Room has been alerted.",
    });
    state.outcome = { kind: "applied", landed: { cancelled: true } };
    expect(await (await POST(post(leagueId, "acquire", CANCEL), ctx(leagueId))).json()).toEqual({ cancelled: true, landed: true, result: "Claim for Claimed Guy cancelled." });
    expect(errors.filter((e) => e.includes("didn't land"))).toHaveLength(2);
  });

  it("answers ESPN's refusal as the web does", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.outcome = { kind: "espn-refused", errors: [{ type: "TRAN_PLAYER_NOT_FREEAGENT", message: "Wire Guy is on waivers" }], detail: "409" };
    const res = await (await load<Post>("acquire")).POST(post(leagueId, "acquire", ADD), ctx(leagueId));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ refused: ["ESPN says the player isn't a free agent any more: Wire Guy is on waivers"] });
    expect(errors.some((e) => e.includes("ESPN refused a free-agent add"))).toBe(true);
  });

  it("400s a body that isn't an add, claim or cancel", async () => {
    const res = await (await load<Post>("acquire")).POST(post(leagueId, "acquire", { ...ADD, kind: "trade" }), ctx(leagueId));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/leagues/:id/team/trades", () => {
  it("dry-runs answering an offer and proposing one in the web's words", async () => {
    const { POST } = await load<Post>("trades");
    const dry = async (body: Record<string, unknown>) => (await (await POST(post(leagueId, "trades", body, "?dryRun=1"), ctx(leagueId))).json()) as TeamDryRun;
    expect(await dry(ACCEPT)).toEqual({ text: "Accept on ESPN? You get Bijan Robinson and send Javonte Williams. It goes through after the league's review.", problems: [] });
    expect(await dry({ kind: "decline", week: view.currentWeek, tradeId: OFFER.id })).toEqual({ text: `Decline ${partner.name}'s offer on ESPN?`, problems: [] });
    expect((await dry({ kind: "withdraw", week: view.currentWeek, tradeId: OFFER.id })).problems).toEqual(["Only the team that made an offer can withdraw it."]);
    const propose = { kind: "propose", week: view.currentWeek, snapshot: snapshotOf(roster), partner: partner.id, gives: [id("Javonte Williams")], gets: [id("Christian McCaffrey")], drops: [] };
    const proposed = (await dry(propose)) as TeamDryRun & { grade: { headline: string; perWeek: number; drops: number[] } };
    expect(proposed).toMatchObject({ text: `Offer ${partner.name} this trade on ESPN? You send Javonte Williams and get Christian McCaffrey.`, problems: [] });
    // The builder's verdict rides along, graded as the web's TradePanel grades it.
    expect(proposed.grade).toMatchObject({ headline: "Costs you", level: "gain" });
    expect(proposed.grade.perWeek).toBeCloseTo(-0.51, 2);
    expect(state.sent).toEqual([]);
  });

  it("writes through the web's trade write and says what landed", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    const { POST } = await load<Post>("trades");
    state.outcome = { kind: "applied", landed: { done: true } };
    expect(await (await POST(post(leagueId, "trades", ACCEPT), ctx(leagueId))).json()).toEqual({ done: true, landed: true, result: "Offer accepted. It's in the league's review." });
    state.outcome = { kind: "applied", landed: { pending: true } };
    const propose = { kind: "propose", week: view.currentWeek, snapshot: snapshotOf(roster), partner: partner.id, gives: [id("Javonte Williams")], gets: [id("Christian McCaffrey")] };
    expect(await (await POST(post(leagueId, "trades", propose), ctx(leagueId))).json()).toEqual({ pending: true, landed: true, result: `Offer sent to ${partner.name}. It's in Pending on ESPN.` });
    expect(state.sent.map((s) => s.kind)).toEqual(["respond", "propose"]);
  });

  it("asks for the consent before writing, and says when ESPN doesn't show the change", async () => {
    const { POST } = await load<Post>("trades");
    const gated = await POST(post(leagueId, "trades", ACCEPT), ctx(leagueId));
    expect(gated.status).toBe(409);
    expect(await gated.json()).toMatchObject({ consent: { version: ESPN_WRITE_VERSION } });
    expect(state.sent).toEqual([]);
    state.outcome = { kind: "applied", landed: { done: false } };
    expect(await (await POST(post(leagueId, "trades", { ...ACCEPT, consentVersion: ESPN_WRITE_VERSION }), ctx(leagueId))).json()).toEqual({
      done: false,
      landed: false,
      result: "ESPN doesn't show that change. Check ESPN. Draft Room has been alerted.",
    });
  });

  it("answers a failed write as the web does", async () => {
    await agreeToWrites(db, userId, ESPN_WRITE_VERSION);
    state.outcome = { kind: "write-failed", detail: "timeout" };
    const res = await (await load<Post>("trades")).POST(post(leagueId, "trades", ACCEPT), ctx(leagueId));
    expect(res.status).toBe(502);
    expect(errors.some((e) => e.includes("ESPN trade accept failed"))).toBe(true);
  });
});

describe("GET /api/v1/leagues/:id/team/trades", () => {
  it("grades each offer and says what the user can do with it", async () => {
    const mine = { ...OFFER, id: "trade-2", proposerTeamId: base.myTeamId, partnerTeamId: partner.id };
    state.load = { ...(state.load as object), view: { ...view, pendingTrades: [OFFER, mine], tradeDeadline: "2026-11-20T17:00:00.000Z" } };
    const res = await (await load<Get>("trades")).GET(get(leagueId, "trades"), ctx(leagueId));
    expect(res.status).toBe(200);
    const out = (await res.json()) as TradesResponse;
    expect(out.deadline).toEqual({ at: "2026-11-20T17:00:00.000Z", passed: false });
    const [theirs, own] = out.offers;
    expect(theirs).toMatchObject({ id: OFFER.id, kind: "theirs", partner: { id: partner.id, name: partner.name }, gets: [id("Bijan Robinson")], gives: [id("Javonte Williams")], actions: ["accept", "decline"] });
    expect(theirs.grade).toMatchObject({ headline: "Costs you", level: expect.any(String), weeks: expect.any(Number) });
    expect(own).toMatchObject({ id: "trade-2", kind: "mine", actions: ["withdraw"] });
  });

  it("offers no accept once the deadline has passed, and nothing on an accepted trade", async () => {
    const accepted = { ...OFFER, id: "trade-3", status: "accepted" as const, processesAt: "2026-09-24T07:00:00.000Z" };
    state.load = { ...(state.load as object), view: { ...view, pendingTrades: [OFFER, accepted], tradeDeadlinePassed: true } };
    const out = (await (await (await load<Get>("trades")).GET(get(leagueId, "trades"), ctx(leagueId))).json()) as TradesResponse;
    expect(out.offers.map((o) => o.actions)).toEqual([["decline"], []]);
    expect(out.offers[1]).toMatchObject({ kind: "accepted", when: { label: "Goes through", at: "2026-09-24T07:00:00.000Z" } });
  });
});
