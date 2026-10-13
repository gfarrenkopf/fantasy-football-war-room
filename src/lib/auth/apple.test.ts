import { generateKeyPairSync, verify } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createTestDb, createTestUser } from "@/lib/db/testing";
import { appleClientSecret, appleDisplayName, storeAppleName } from "./apple";

describe("appleClientSecret", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("is an ES256 JWT with the claims Apple checks, verifiable with the key's public half", () => {
    const now = 1_760_000_000;
    const jwt = appleClientSecret({ teamId: "TEAM", keyId: "KID", clientId: "tech.apeman.draftroom.web", privateKey: pem }, now);
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "KID" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: "TEAM",
      iat: now,
      exp: now + 86_400,
      aud: "https://appleid.apple.com",
      sub: "tech.apeman.draftroom.web",
    });
    const ok = verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("appleDisplayName", () => {
  it("joins the parts Apple sent, or is null", () => {
    expect(appleDisplayName({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(appleDisplayName({ firstName: " Ada ", lastName: null })).toBe("Ada");
    expect(appleDisplayName({})).toBeNull();
    expect(appleDisplayName(undefined)).toBeNull();
  });
});

describe("storeAppleName", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await createTestDb()));
  afterAll(() => close());

  const nameOf = async (id: string) => (await db.select({ name: users.name }).from(users).where(eq(users.id, id)))[0].name;

  it("names an unnamed account", async () => {
    const id = await createTestUser(db);
    await storeAppleName(db, id, "Ada Lovelace");
    expect(await nameOf(id)).toBe("Ada Lovelace");
  });

  it("never overwrites a name the account already has", async () => {
    const id = await createTestUser(db);
    await db.update(users).set({ name: "Ada" }).where(eq(users.id, id));
    await storeAppleName(db, id, "Someone Else");
    expect(await nameOf(id)).toBe("Ada");
  });
});
