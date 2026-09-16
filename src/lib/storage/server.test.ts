import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { standardRoster } from "@/lib/data";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { DraftState } from "@/lib/draft/types";
import * as api from "@/lib/server/leagues";
import { migrateDraftState, parseLeagueRecord } from "./records";
import { createServerStores, hasUnsyncedChanges, type SyncIssue } from "./server";
import { memoryStorage } from "./testing";
import type { LeagueRecord } from "./types";

/**
 * The server stores against a fake fetch that routes requests to the real data layer
 * (src/lib/server/leagues.ts on PGlite), mirroring what the route handlers do.
 */

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

interface FakeServer {
  fetch: typeof fetch;
  offline: boolean;
  signedOut: boolean;
  requests: string[];
}

function fakeServer(userId: string): FakeServer {
  const server: FakeServer = {
    offline: false,
    signedOut: false,
    requests: [],
    fetch: async (input, init) => {
      const method = init?.method ?? "GET";
      const path = String(input);
      server.requests.push(`${method} ${path}`);
      if (server.offline) throw new TypeError("Failed to fetch");
      if (server.signedOut) return Response.json({ error: "Sign in required" }, { status: 401 });
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const [, , , id, sub] = path.split("/"); // "", "api", "leagues", id, "draft"

      if (!id && method === "GET") return Response.json({ leagues: await api.listLeagues(db, userId) });
      if (id && !sub && method === "PUT") {
        const record = parseLeagueRecord(body);
        if (!record) return Response.json({}, { status: 400 });
        const result = await api.upsertLeague(db, userId, record);
        return result.status === "ok" ? Response.json(result) : Response.json({}, { status: 404 });
      }
      if (id && !sub && method === "DELETE") return new Response(null, { status: (await api.deleteLeague(db, userId, id)) ? 204 : 404 });
      if (sub === "draft" && method === "GET") {
        const draft = await api.getDraft(db, userId, id);
        return draft ? Response.json(draft) : Response.json({}, { status: 404 });
      }
      if (sub === "draft" && method === "PUT") {
        const result = await api.putDraft(db, userId, id, migrateDraftState(body.state)!, body.baseRevision);
        if (result.status === "ok") return Response.json({ revision: result.revision });
        if (result.status === "conflict") return Response.json(result.current, { status: 409 });
        return Response.json({}, { status: 404 });
      }
      return new Response(null, { status: 405 });
    },
  };
  return server;
}

let seq = 0;
const league = (patch: Partial<LeagueRecord> = {}): LeagueRecord => ({
  id: `sync-league-${++seq}`,
  name: "Home league",
  season: 2026,
  datasetId: "2026-abc",
  settings: { teams: 12, mySlot: 3, scoring: "ppr", valueThreshold: 10, roster: standardRoster() },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...patch,
});
const draft = (...ids: string[]): DraftState => ({ version: 1, picks: ids.map((playerId) => ({ playerId, mine: false })) });

let userId: string;
let server: FakeServer;
let issues: SyncIssue[];

beforeEach(async () => {
  userId = await createTestUser(db);
  server = fakeServer(userId);
  issues = [];
});

/** A device: its own localStorage, same account and server. */
const device = (storage = memoryStorage()) => ({
  storage,
  stores: createServerStores({ userId, storage, fetch: server.fetch, onSyncIssue: (i) => issues.push(i), retryDelays: [60_000] }),
});

describe("server-backed stores", () => {
  it("syncs a league and its picks to a second device", async () => {
    const phone = device();
    const l = league();
    await phone.stores.league.saveLeague(l);
    await phone.stores.draft.saveDraftState(l.id, draft("a", "b"));
    expect(await phone.stores.sync!.flush()).toBe(true);

    const laptop = device();
    expect((await laptop.stores.league.listLeagues()).map((x) => x.id)).toEqual([l.id]);
    expect(await laptop.stores.draft.getDraftState(l.id)).toEqual(draft("a", "b"));
  });

  it("keeps picks on the device while offline and syncs them when the API is back", async () => {
    const phone = device();
    const l = league();
    await phone.stores.league.saveLeague(l);
    await phone.stores.sync!.flush();

    server.offline = true;
    // Writes resolve immediately even though the API is unreachable.
    await phone.stores.draft.saveDraftState(l.id, draft("a"));
    await phone.stores.draft.saveDraftState(l.id, draft("a", "b"));
    expect(await phone.stores.draft.getDraftState(l.id)).toEqual(draft("a", "b"));
    expect(await phone.stores.sync!.flush()).toBe(false);
    expect(hasUnsyncedChanges(phone.storage, userId)).toBe(true);
    expect(issues).toEqual([{ kind: "offline" }]); // reported once, not per failed request

    // A reload while still offline keeps the unsynced picks.
    const reloaded = device(phone.storage);
    expect(await reloaded.stores.league.listLeagues()).toHaveLength(1);
    expect(await reloaded.stores.draft.getDraftState(l.id)).toEqual(draft("a", "b"));

    server.offline = false;
    expect(await reloaded.stores.sync!.flush()).toBe(true);
    expect((await api.getDraft(db, userId, l.id))?.state).toEqual(draft("a", "b"));
  });

  it("retries automatically after a network failure", async () => {
    vi.useFakeTimers();
    try {
      const phone = device();
      const l = league();
      server.offline = true;
      await phone.stores.league.saveLeague(l);
      await phone.stores.draft.saveDraftState(l.id, draft("a"));
      await vi.advanceTimersByTimeAsync(0);
      server.offline = false;
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(async () => expect((await api.getDraft(db, userId, l.id))?.state).toEqual(draft("a")));
    } finally {
      vi.useRealTimers();
    }
  });

  it("uploads a league created offline before its draft", async () => {
    const phone = device();
    const l = league();
    server.offline = true;
    await phone.stores.league.saveLeague(l);
    await phone.stores.draft.saveDraftState(l.id, draft("x"));
    server.offline = false;
    expect(await phone.stores.sync!.flush()).toBe(true);
    expect((await api.listLeagues(db, userId)).map((x) => x.id)).toEqual([l.id]);
    expect((await api.getDraft(db, userId, l.id))?.state).toEqual(draft("x"));
  });

  it("on a conflict, this device's latest picks win and the conflict is reported", async () => {
    const l = league();
    const phone = device();
    const laptop = device();
    await phone.stores.league.saveLeague(l);
    await phone.stores.draft.saveDraftState(l.id, draft("a"));
    await phone.stores.sync!.flush();
    await laptop.stores.league.listLeagues();
    expect(await laptop.stores.draft.getDraftState(l.id)).toEqual(draft("a"));

    // Both devices log a pick from revision 1; the phone syncs first.
    await phone.stores.draft.saveDraftState(l.id, draft("a", "phone"));
    await phone.stores.sync!.flush();
    await laptop.stores.draft.saveDraftState(l.id, draft("a", "laptop"));
    expect(await laptop.stores.sync!.flush()).toBe(true);

    expect(issues).toContainEqual({ kind: "conflict", leagueId: l.id });
    expect(await api.getDraft(db, userId, l.id)).toEqual({ state: draft("a", "laptop"), revision: 3 });
  });

  it("collapses a burst of picks into a few requests", async () => {
    const phone = device();
    const l = league();
    await phone.stores.league.saveLeague(l);
    await phone.stores.sync!.flush();
    server.requests = [];
    const picks: string[] = [];
    for (let i = 0; i < 20; i++) {
      picks.push(`p${i}`);
      void phone.stores.draft.saveDraftState(l.id, draft(...picks));
    }
    expect(await phone.stores.sync!.flush()).toBe(true);
    expect(server.requests.filter((r) => r.startsWith("PUT")).length).toBeLessThanOrEqual(3);
    expect((await api.getDraft(db, userId, l.id))?.state?.picks).toHaveLength(20);
  });

  it("drops a league deleted on another device, and syncs deletes made offline", async () => {
    const a = league();
    const b = league();
    const phone = device();
    const laptop = device();
    await phone.stores.league.saveLeague(a);
    await phone.stores.league.saveLeague(b);
    await phone.stores.sync!.flush();
    expect(await laptop.stores.league.listLeagues()).toHaveLength(2);

    await phone.stores.league.deleteLeague(a.id);
    await phone.stores.sync!.flush();
    expect((await laptop.stores.league.listLeagues()).map((x) => x.id)).toEqual([b.id]);

    server.offline = true;
    await laptop.stores.league.deleteLeague(b.id);
    server.offline = false;
    expect(await laptop.stores.sync!.flush()).toBe(true);
    expect(await api.listLeagues(db, userId)).toEqual([]);
  });

  it("resets a draft by saving it empty, so the reset reaches other devices", async () => {
    const phone = device();
    const l = league();
    await phone.stores.league.saveLeague(l);
    await phone.stores.draft.saveDraftState(l.id, draft("a"));
    await phone.stores.draft.resetDraft(l.id);
    await phone.stores.sync!.flush();
    expect(await device().stores.draft.getDraftState(l.id)).toEqual(draft());
  });

  it("reports an expired session and keeps changes to sync later", async () => {
    const phone = device();
    const l = league();
    await phone.stores.league.saveLeague(l);
    await phone.stores.sync!.flush();
    server.signedOut = true;
    await phone.stores.draft.saveDraftState(l.id, draft("a"));
    expect(await phone.stores.sync!.flush()).toBe(false);
    expect(issues).toContainEqual({ kind: "signed-out" });
    server.signedOut = false;
    expect(await phone.stores.sync!.flush()).toBe(true);
  });

  it("keeps a newer local league edit over an older one from the server", async () => {
    const phone = device();
    const l = league();
    await phone.stores.league.saveLeague(l);
    await phone.stores.sync!.flush();
    server.offline = true;
    await phone.stores.league.saveLeague({ ...l, name: "Renamed offline", updatedAt: "2026-09-10T00:00:00.000Z" });
    server.offline = false;
    expect((await phone.stores.league.listLeagues())[0].name).toBe("Renamed offline");
    await phone.stores.sync!.flush();
    expect((await api.listLeagues(db, userId))[0].name).toBe("Renamed offline");
  });
});

describe("server-backed stores: no-op saves", () => {
  it("doesn't send a request when a loaded draft is saved back unchanged", async () => {
    const phone = device();
    const l = league();
    await phone.stores.league.saveLeague(l);
    await phone.stores.draft.saveDraftState(l.id, draft("a"));
    await phone.stores.sync!.flush();

    const laptop = device();
    const loaded = await laptop.stores.draft.getDraftState(l.id);
    server.requests = [];
    await laptop.stores.draft.saveDraftState(l.id, loaded!);
    expect(await laptop.stores.sync!.flush()).toBe(true);
    expect(server.requests.filter((r) => r.startsWith("PUT"))).toEqual([]);
    expect((await api.getDraft(db, userId, l.id))?.revision).toBe(1);
  });
});
