import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { espnSeasonLinks, leagues, seasonEmails } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import type { SeasonEmail } from "@/lib/season/email";
import { mintBridgeToken } from "./espn/bridgeTokens";
import { connectEspn } from "./leagues";
import { runDraftDayJob } from "./seasonDraftDay";
import { createTestLeague } from "./testLeagues";

vi.mock("server-only", () => ({}));

const MIN = 60 * 1000;
const NOW = new Date("2026-08-30T22:15:00Z");
const in_ = (minutes: number) => new Date(NOW.getTime() + minutes * MIN).toISOString();

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

let seq = 0;
/** A league connected for the season, drafting on ESPN at `draftAt`. */
async function connected(name: string, draftAt: string | null) {
  const userId = await createTestUser(db, `${name.toLowerCase().replace(/\W/g, "")}-${crypto.randomUUID()}@example.test`);
  const leagueId = await createTestLeague(db, userId, name);
  const espnLeagueId = String(7000 + ++seq);
  await db.insert(espnSeasonLinks).values({ leagueId, userId, espnLeagueId, espnTeamId: 2, season: 2026 });
  await db.update(leagues).set({ draftAt }).where(eq(leagues.id, leagueId));
  return { userId, leagueId, espnLeagueId };
}

describe("runDraftDayJob (APE-336)", () => {
  let sent: { to: string; email: SeasonEmail }[];
  const deps = () => ({
    sendEmail: async (to: string, email: SeasonEmail) => void sent.push({ to, email }),
    baseUrl: "https://draftroom.example",
    secret: "test-secret",
    now: NOW,
  });
  beforeEach(async () => {
    await db.delete(espnSeasonLinks);
    await db.delete(seasonEmails);
    sent = [];
  });
  afterEach(() => vi.restoreAllMocks());

  it("emails when ESPN opens the draft room, with the draft's own ESPN page, once", async () => {
    const { espnLeagueId } = await connected("Home League", in_(50));
    await connected("Later League", in_(75));
    await connected("Earlier League", in_(40));
    await connected("Date Only", "2026-08-30");

    expect(await runDraftDayJob(db, deps())).toEqual({ dryRun: false, drafts: 1, connected: 0, emails: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toMatch(/^homeleague/);
    expect(sent[0].email.subject).toBe("Your ESPN draft room is open: Home League");
    expect(sent[0].email.text).toContain(`https://fantasy.espn.com/football/draft?leagueId=${espnLeagueId}&teamId=2&seasonId=2026`);
    expect(sent[0].email.text).toContain("Home League (drafts at 7:05 PM ET)");
    expect(sent[0].email.text).toContain("https://draftroom.example/espn?for=draft&league=");

    expect((await runDraftDayJob(db, deps())).emails).toBe(0);
  });

  it("leaves a draft that's already connected alone", async () => {
    const { userId, leagueId, espnLeagueId } = await connected("Paired", in_(50));
    await mintBridgeToken(db, { userId, leagueId, espnLeagueId, espnTeamId: 2, season: 2026 });
    expect(await runDraftDayJob(db, deps())).toEqual({ dryRun: false, drafts: 1, connected: 1, emails: 0 });
  });

  it("counts without sending on a dry run", async () => {
    await connected("Dry", in_(55));
    expect(await runDraftDayJob(db, deps(), { dryRun: true })).toEqual({ dryRun: true, drafts: 1, connected: 0, emails: 0 });
    expect(sent).toEqual([]);
  });
});

describe("keeping ESPN's draft time on a connected league", () => {
  it("records it, and rewrites the league only when it changes", async () => {
    const userId = await createTestUser(db);
    const leagueId = await createTestLeague(db, userId);
    const espn = { espnLeagueId: "9001", espnTeamId: 1, season: 2026 };
    await connectEspn(db, userId, leagueId, espn, { draftAt: in_(120) });
    const [row] = await db.select({ draftAt: leagues.draftAt, updatedAt: leagues.updatedAt }).from(leagues).where(eq(leagues.id, leagueId));
    expect(row.draftAt).toBe(in_(120));
    await connectEspn(db, userId, leagueId, espn, {});
    const [again] = await db.select({ draftAt: leagues.draftAt, updatedAt: leagues.updatedAt }).from(leagues).where(eq(leagues.id, leagueId));
    expect(again).toEqual(row);
  });
});
