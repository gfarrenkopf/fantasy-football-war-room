import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const CLOUD = { DATABASE_URL: "postgres://localhost/unused", NEXTAUTH_SECRET: "secret" };

async function get(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { GET } = await import("@/app/.well-known/apple-app-site-association/route");
  return GET();
}

describe("GET /.well-known/apple-app-site-association", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const name of [...Object.keys(CLOUD), "AUTH_APPLE_TEAM_ID"]) vi.stubEnv(name, "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("names the app by team id and claims only the app's links", async () => {
    const res = await get({ ...CLOUD, AUTH_APPLE_TEAM_ID: "ABCDE12345" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = await res.json();
    expect(body.webcredentials).toEqual({ apps: ["ABCDE12345.tech.apeman.draftroom"] });
    const [details] = body.applinks.details;
    expect(details.appIDs).toEqual(["ABCDE12345.tech.apeman.draftroom"]);
    expect(details.components.map((c: { "/": string }) => c["/"])).toEqual(["/api/auth/callback/resend", "/app/callback", "/season/*"]);
    expect(details.components[0]["?"]).toEqual({ callbackUrl: "*signed-in*" });
  });

  it("is 404 with cloud features off", async () => {
    expect((await get({ AUTH_APPLE_TEAM_ID: "ABCDE12345" })).status).toBe(404);
  });

  it("is 404 without a team id", async () => {
    expect((await get(CLOUD)).status).toBe(404);
  });
});
