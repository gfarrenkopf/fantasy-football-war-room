import { describe, expect, it } from "vitest";
import { isSameOrigin, MAX_BODY_BYTES, readJson } from "./http";

const req = (headers: Record<string, string>, body?: string) => new Request("http://localhost:3000/api/leagues/x", { method: "PUT", headers, body });

describe("isSameOrigin", () => {
  it("allows requests without an Origin and from the same host", () => {
    expect(isSameOrigin(req({ host: "localhost:3000" }))).toBe(true);
    expect(isSameOrigin(req({ host: "localhost:3000", origin: "http://localhost:3000" }))).toBe(true);
    expect(isSameOrigin(req({ host: "app:3000", "x-forwarded-host": "warroom.example.com", origin: "https://warroom.example.com" }))).toBe(true);
  });

  it("rejects other origins and garbage", () => {
    expect(isSameOrigin(req({ host: "localhost:3000", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(req({ host: "localhost:3000", origin: "null" }))).toBe(false);
  });
});

describe("readJson", () => {
  it("parses JSON bodies", async () => {
    expect(await readJson(req({ "content-type": "application/json" }, '{"a":1}'))).toEqual({ ok: true, body: { a: 1 } });
  });

  it.each([
    ["wrong content type", req({ "content-type": "text/plain" }, "{}"), 415],
    ["malformed JSON", req({ "content-type": "application/json" }, "{nope"), 400],
    ["oversized body", req({ "content-type": "application/json" }, JSON.stringify("x".repeat(MAX_BODY_BYTES))), 413],
  ])("rejects %s", async (_, request, status) => {
    const result = await readJson(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(status);
  });
});
