import { describe, expect, it } from "vitest";
import { formatServerError, SERVER_ERROR_TAG } from "./errorLog";

const request = { method: "PUT", path: "/api/leagues/abc/draft" };
const context = { routePath: "/api/leagues/[id]/draft", routeType: "route" };

const parse = (line: string) => {
  expect(line.startsWith(`${SERVER_ERROR_TAG} `)).toBe(true);
  return JSON.parse(line.slice(SERVER_ERROR_TAG.length + 1));
};

describe("formatServerError", () => {
  it("writes one tagged JSON line with the route and error", () => {
    const line = formatServerError(new TypeError("boom\nsecond line"), request, context);
    expect(line).not.toContain("\n");
    expect(parse(line)).toEqual({
      method: "PUT",
      path: "/api/leagues/abc/draft",
      route: "/api/leagues/[id]/draft",
      type: "route",
      message: "TypeError: boom\nsecond line",
    });
  });

  it("drops the query string, which can hold sign-in tokens and emails", () => {
    const line = formatServerError(new Error("x"), { method: "GET", path: "/api/auth/callback/resend?token=secret&email=a%40b.c" }, context);
    expect(line).not.toContain("secret");
    expect(parse(line).path).toBe("/api/auth/callback/resend");
  });

  it("keeps React's digest and handles non-Error throws", () => {
    const rendered = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "12345" });
    expect(parse(formatServerError(rendered, request, context)).digest).toBe("12345");
    expect(parse(formatServerError("plain string", request, context)).message).toBe("plain string");
  });

  it("truncates very long messages", () => {
    expect(parse(formatServerError(new Error("x".repeat(5000)), request, context)).message.length).toBeLessThan(600);
  });
});
