import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { bookmarkletFor } from "./bookmarklet";

/**
 * Runs the bookmark as a browser would, with import() resolving or failing as `load` says. node:vm
 * can't hook import() without a flag, so the run swaps it for a stand-in of the same shape.
 */
async function run(load: "ok" | "fail") {
  const imported: string[] = [];
  const alert = vi.fn();
  const window: Record<string, unknown> = {};
  const loadModule = (specifier: string) => {
    imported.push(specifier);
    return load === "ok" ? Promise.resolve({}) : Promise.reject(new Error("blocked"));
  };
  const code = bookmarkletFor("https://draftroom.online").slice("javascript:".length);
  expect(code.match(/\bimport\(/g)).toHaveLength(1);
  vm.runInContext(code.replace(/\bimport\(/, "loadModule("), vm.createContext({ Date: { now: () => 123 }, alert, window, loadModule }));
  await new Promise((r) => setTimeout(r, 0));
  return { imported, alert, window };
}

describe("bookmarkletFor", () => {
  it("is a javascript: URL that imports the bridge from Draft Room's origin", async () => {
    expect(bookmarkletFor("https://draftroom.online").startsWith("javascript:")).toBe(true);
    const { imported } = await run("fail");
    expect(imported).toEqual(["https://draftroom.online/espn-bridge.js?t=123"]);
  });

  // A module has no document.currentScript to find its origin by.
  it("leaves Draft Room's origin on window for the bridge", async () => {
    const { window } = await run("fail");
    expect(window.__draftRoomOrigin).toBe("https://draftroom.online");
  });

  it("says so when the bridge can't load, rather than doing nothing", async () => {
    const { alert } = await run("fail");
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("Draft Room couldn't load on this page"));
    expect((await run("ok")).alert).not.toHaveBeenCalled();
  });

  // ESPN's phone site rewrites the src of script tags it doesn't know (APE-339), so there must be none.
  it("never adds a script tag", () => {
    expect(bookmarkletFor("https://draftroom.online")).not.toMatch(/createElement|appendChild/);
  });

  // It's typed or pasted into a bookmark's address on a phone, where a stray quote breaks it silently.
  it("stays one line with no characters a bookmark's address would mangle", () => {
    expect(bookmarkletFor("https://draftroom.online")).not.toMatch(/[\n\r\t`]/);
  });
});
