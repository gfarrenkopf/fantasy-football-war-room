import { afterEach, describe, expect, it, vi } from "vitest";
import { beaconLine, logBudget } from "./bridgeBeacon";

vi.mock("server-only", () => ({}));

describe("beaconLine", () => {
  it("logs a bookmark click with where it happened", () => {
    expect(beaconLine({ event: "load", mode: "draft", platform: "ios-safari", espnLeagueId: "704343562" })).toEqual({
      line: "[espn-bridge] event=load mode=draft platform=ios-safari league=704343562",
      problem: false,
    });
    expect(beaconLine({ event: "load", mode: "season", platform: "android", espnLeagueId: "", again: "1" })!.line).toBe(
      "[espn-bridge] event=load mode=season platform=android again=1",
    );
  });

  it("marks an error as a problem, for the alert job", () => {
    expect(beaconLine({ event: "error", mode: "draft", platform: "desktop", error: "TypeError" })).toEqual({
      line: "[espn-bridge] problem event=error mode=draft platform=desktop error=TypeError",
      problem: true,
    });
  });

  it("logs how pairing went", () => {
    expect(beaconLine({ event: "pair", mode: "draft", platform: "ios-chrome", outcome: "blocked" })!.line).toContain("outcome=blocked");
  });

  it("drops anything the bridge doesn't send, rather than logging what a stranger wrote", () => {
    expect(beaconLine(null)).toBeNull();
    expect(beaconLine({ event: "load", mode: "draft", platform: "windows-phone" })).toBeNull();
    expect(beaconLine({ event: "load\n[server-error] boom", mode: "draft", platform: "desktop" })).toBeNull();
    expect(beaconLine({ event: "error", mode: "draft", platform: "desktop", error: "Type Error\n" })).toBeNull();
    expect(beaconLine({ event: "pair", mode: "draft", platform: "desktop", outcome: "pwned" })).toBeNull();
    expect(beaconLine({ event: "load", mode: "draft", platform: "desktop", espnLeagueId: "1 [server-error]" })!.line).not.toContain("server-error");
  });
});

describe("logBudget", () => {
  it("allows so many lines a window, then starts over", () => {
    let t = 0;
    const allow = logBudget(2, 1000, () => t);
    expect([allow(), allow(), allow()]).toEqual([true, true, false]);
    t = 1000;
    expect(allow()).toBe(true);
  });
});

describe("POST /api/espn/bridge/beacon", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function route(enabled = true) {
    if (enabled) {
      vi.stubEnv("DATABASE_URL", "postgres://localhost/unused");
      vi.stubEnv("NEXTAUTH_SECRET", "secret");
    }
    return import("@/app/api/espn/bridge/beacon/route");
  }
  const send = (body: string, origin = "https://fantasy.espn.com") =>
    new Request("http://localhost/api/espn/bridge/beacon", { method: "POST", headers: { "content-type": "text/plain", origin }, body });

  it("logs a beacon from ESPN's page, as plain text with no preflight", async () => {
    const { POST } = await route();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const res = await POST(send(JSON.stringify({ event: "load", mode: "draft", platform: "desktop" })));
    expect(res.status).toBe(204);
    expect(info).toHaveBeenCalledWith("[espn-bridge] event=load mode=draft platform=desktop");
  });

  it("logs errors where the alert job looks", async () => {
    const { POST } = await route();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await POST(send(JSON.stringify({ event: "error", mode: "season", platform: "android", error: "TypeError" })));
    expect(warn.mock.calls[0][0]).toMatch(/^\[espn-bridge\] problem /);
  });

  it("ignores other sites and junk", async () => {
    const { POST } = await route();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await POST(send(JSON.stringify({ event: "load", mode: "draft", platform: "desktop" }), "https://evil.example"));
    expect((await POST(send("not json"))).status).toBe(204);
    expect(info).not.toHaveBeenCalled();
  });

  it("isn't there when ESPN sync is off", async () => {
    const { POST } = await route(false);
    expect((await POST(send("{}"))).status).toBe(404);
  });
});
