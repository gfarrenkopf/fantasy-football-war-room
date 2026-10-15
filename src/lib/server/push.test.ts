import { generateKeyPairSync, verify } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deviceTokens } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import type { Db } from "@/lib/db/types";
import { apnsJwt, createApnsClient, type ApnsReply, type ApnsRequest } from "./apns";
import { createAppSession } from "./appAuth";
import { registerDevice } from "./devices";

vi.mock("server-only", () => ({}));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const key = { keyId: "KEY1234567", teamId: "TEAM123456", privateKey: pem };
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

/** A transport that records requests and answers from a script, last reply repeating. */
function fakeTransport(...replies: ApnsReply[]) {
  const requests: ApnsRequest[] = [];
  const transport = async (request: ApnsRequest) => {
    requests.push(request);
    return replies[Math.min(requests.length - 1, replies.length - 1)];
  };
  return { requests, transport };
}
const noSleep = async () => {};
const alert = { pushType: "alert" as const, topic: "tech.apeman.draftroom", payload: { aps: { alert: { title: "t", body: "b" } } } };

describe("apnsJwt", () => {
  it("is an ES256 JWT naming the key and team, signed by the key", () => {
    const jwt = apnsJwt(key, 1_800_000_000);
    const [header, claims, signature] = jwt.split(".");
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(decode(claims)).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
    expect(verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
  });
});

describe("createApnsClient", () => {
  it("addresses each environment's host with the APNs headers", async () => {
    const { requests, transport } = fakeTransport({ status: 200 });
    const apns = createApnsClient(key, { transport, now: () => 1_800_000_000 });
    expect(await apns.send({ token: "abc", environment: "production" }, { ...alert, collapseId: "c1" })).toEqual({ kind: "sent" });
    expect(await apns.send({ token: "def", environment: "sandbox" }, { ...alert, pushType: "liveactivity", topic: "tech.apeman.draftroom.push-type.liveactivity", priority: 5, expiration: 0 })).toEqual({ kind: "sent" });

    expect(requests[0]).toMatchObject({
      host: "api.push.apple.com",
      path: "/3/device/abc",
      headers: { "apns-topic": "tech.apeman.draftroom", "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": "c1" },
      body: JSON.stringify(alert.payload),
    });
    // ECDSA signatures differ each time, so compare the signed part.
    const signed = (jwt: string) => jwt.split(".").slice(0, 2).join(".");
    expect(signed(requests[0].headers.authorization.replace("bearer ", ""))).toBe(signed(apnsJwt(key, 1_800_000_000)));
    expect(requests[1]).toMatchObject({
      host: "api.sandbox.push.apple.com",
      path: "/3/device/def",
      headers: { "apns-topic": "tech.apeman.draftroom.push-type.liveactivity", "apns-push-type": "liveactivity", "apns-priority": "5", "apns-expiration": "0" },
    });
  });

  it("reuses the provider token for 50 minutes, then signs a new one", async () => {
    let t = 1_800_000_000;
    const { requests, transport } = fakeTransport({ status: 200 });
    const apns = createApnsClient(key, { transport, now: () => t });
    await apns.send({ token: "a", environment: "production" }, alert);
    t += 49 * 60;
    await apns.send({ token: "a", environment: "production" }, alert);
    t += 2 * 60;
    await apns.send({ token: "a", environment: "production" }, alert);
    const auth = requests.map((r) => r.headers.authorization);
    expect(auth[0]).toBe(auth[1]);
    expect(auth[2]).not.toBe(auth[1]);
  });

  it("calls a token dead on 410 or BadDeviceToken", async () => {
    const gone = createApnsClient(key, fakeTransport({ status: 410, reason: "Unregistered" }));
    expect(await gone.send({ token: "a", environment: "production" }, alert)).toEqual({ kind: "dead", reason: "Unregistered" });
    const bad = createApnsClient(key, fakeTransport({ status: 400, reason: "BadDeviceToken" }));
    expect(await bad.send({ token: "a", environment: "production" }, alert)).toEqual({ kind: "dead", reason: "BadDeviceToken" });
  });

  it("retries 429, 5xx and dropped connections a little, then gives up", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    const flaky = fakeTransport({ status: 503, reason: "ServiceUnavailable" }, { status: 0, reason: "NoResponse" }, { status: 200 });
    expect(await createApnsClient(key, { transport: flaky.transport, sleep }).send({ token: "a", environment: "production" }, alert)).toEqual({ kind: "sent" });
    expect(sleeps).toEqual([250, 500]);

    const busy = fakeTransport({ status: 429, reason: "TooManyRequests" });
    expect(await createApnsClient(key, { transport: busy.transport, sleep: noSleep }).send({ token: "a", environment: "production" }, alert)).toEqual({
      kind: "failed",
      status: 429,
      reason: "TooManyRequests",
    });
    expect(busy.requests).toHaveLength(3);
  });

  it("doesn't retry other refusals, but signs a new provider token once when Apple says it expired", async () => {
    const payload = fakeTransport({ status: 400, reason: "PayloadTooLarge" });
    expect(await createApnsClient(key, { transport: payload.transport, sleep: noSleep }).send({ token: "a", environment: "production" }, alert)).toMatchObject({ kind: "failed", status: 400 });
    expect(payload.requests).toHaveLength(1);

    let t = 1_800_000_000;
    const expired = fakeTransport({ status: 403, reason: "ExpiredProviderToken" }, { status: 200 });
    const apns = createApnsClient(key, { transport: expired.transport, sleep: noSleep, now: () => t++ });
    expect(await apns.send({ token: "a", environment: "production" }, alert)).toEqual({ kind: "sent" });
    expect(expired.requests[0].headers.authorization).not.toBe(expired.requests[1].headers.authorization);
  });
});

describe("sendPush", () => {
  async function load(env: Record<string, string>) {
    for (const [name, value] of Object.entries({ DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret", ...env })) vi.stubEnv(name, value);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    return import("./push");
  }
  const apnsEnv = { APNS_KEY_ID: key.keyId, APNS_TEAM_ID: key.teamId, APNS_PRIVATE_KEY: pem.replace(/\n/g, "\\n") };

  async function userWithDevices(...tokens: string[]) {
    const userId = await createTestUser(db);
    const { token: session } = await createAppSession(db, userId);
    for (const token of tokens) await registerDevice(db, userId, session, { token, environment: "production", appVersion: "1.0" });
    return userId;
  }

  it("builds the alert payload", async () => {
    const { alertPayload } = await load({});
    expect(alertPayload({ title: "Out", body: "Swap him", threadId: "league-1", category: "lineup", timeSensitive: true, data: { link: "draftroom://x" } })).toEqual({
      aps: { alert: { title: "Out", body: "Swap him" }, sound: "default", "thread-id": "league-1", category: "lineup", "interruption-level": "time-sensitive" },
      link: "draftroom://x",
    });
  });

  it("does nothing when push is off", async () => {
    const { sendPush, apnsClient } = await load({});
    expect(apnsClient()).toBeNull();
    const userId = await userWithDevices("aa".repeat(32));
    expect(await sendPush(db, userId, { title: "t", body: "b" })).toEqual({ sent: 0, removed: 0, failed: 0 });
  });

  it("is on with all three APNS_* variables, and warns about a partial setup", async () => {
    expect((await load(apnsEnv)).apnsClient()).not.toBeNull();
    vi.resetModules();
    vi.unstubAllEnvs();
    await load({ APNS_KEY_ID: "KEY" });
    const { config } = await import("@/lib/config");
    expect(config.pushEnabled).toBe(false);
    expect(console.warn).toHaveBeenCalledWith("[config] APNS_TEAM_ID, APNS_PRIVATE_KEY are not set, so push notifications are off.");
  });

  it("fans out to every device, deletes dead tokens and logs other failures without the token", async () => {
    const { sendPush } = await load(apnsEnv);
    const [ok, dead, failing] = ["11".repeat(32), "22".repeat(32), "33".repeat(32)];
    const userId = await userWithDevices(ok, dead, failing);
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => void errors.push(line));
    const apns = createApnsClient(key, {
      sleep: noSleep,
      transport: async (r) => (r.path.endsWith(ok) ? { status: 200 } : r.path.endsWith(dead) ? { status: 410, reason: "Unregistered" } : { status: 400, reason: "PayloadTooLarge" }),
    });
    expect(await sendPush(db, userId, { title: "t", body: "b" }, apns)).toEqual({ sent: 1, removed: 1, failed: 1 });
    expect(await db.select().from(deviceTokens).where(eq(deviceTokens.token, dead))).toEqual([]);
    expect(errors).toEqual([expect.stringMatching(/^\[server-error\] .*"PayloadTooLarge"/)]);
    expect(errors[0]).not.toContain(failing);
  });
});
