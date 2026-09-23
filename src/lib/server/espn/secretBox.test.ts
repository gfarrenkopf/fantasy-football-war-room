import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, parseKey, seal } from "./secretBox";

const key = randomBytes(32);

describe("secretBox", () => {
  it("round-trips, with a fresh IV every time", () => {
    const a = seal("-342755166", key, "user:league");
    const b = seal("-342755166", key, "user:league");
    expect(a).not.toBe(b);
    expect(a).not.toContain("342755166");
    expect(open(a, key, "user:league")).toBe("-342755166");
  });

  it("refuses a tampered value, another key, or another row's context", () => {
    const sealed = seal("secret", key, "user:league");
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 1;
    expect(open([...parts.slice(0, 3), flipped.toString("base64url")].join("."), key, "user:league")).toBeNull();
    expect(open(sealed, randomBytes(32), "user:league")).toBeNull();
    expect(open(sealed, key, "someone-else:league")).toBeNull();
    expect(open("not sealed", key, "user:league")).toBeNull();
  });

  it("only accepts a 32-byte base64 key", () => {
    expect(parseKey(key.toString("base64"))?.equals(key)).toBe(true);
    expect(parseKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseKey(undefined)).toBeNull();
  });
});
