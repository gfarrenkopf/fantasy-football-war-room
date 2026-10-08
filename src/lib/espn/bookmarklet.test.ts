import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { bookmarkletFor } from "./bookmarklet";

type Script = { src: string; onerror?: () => void };

function run(body: unknown) {
  const appended: Script[] = [];
  const alert = vi.fn();
  const target = { appendChild: (el: Script) => appended.push(el) };
  const context = vm.createContext({
    Date: { now: () => 123 },
    alert,
    document: { createElement: () => ({ src: "" }), body: body === undefined ? target : body, documentElement: target },
  });
  vm.runInContext(bookmarkletFor("https://draftroom.online").slice("javascript:".length), context);
  return { appended, alert };
}

describe("bookmarkletFor", () => {
  it("is a javascript: URL that appends the bridge script from Draft Room's origin", () => {
    expect(bookmarkletFor("https://draftroom.online").startsWith("javascript:")).toBe(true);
    const { appended } = run(undefined);
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe("https://draftroom.online/espn-bridge.js?t=123");
  });

  it("says so when the bridge can't load, rather than doing nothing", () => {
    const { appended, alert } = run(undefined);
    appended[0].onerror!();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("Draft Room couldn't load on this page"));
  });

  it("still loads on a page that has no body yet", () => {
    expect(run(null).appended).toHaveLength(1);
  });

  // It's typed or pasted into a bookmark's address on a phone, where a stray quote breaks it silently.
  it("stays one line with no characters a bookmark's address would mangle", () => {
    expect(bookmarkletFor("https://draftroom.online")).not.toMatch(/[\n\r\t`]/);
  });
});
