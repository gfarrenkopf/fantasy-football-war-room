import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { bookmarkletFor } from "./bookmarklet";

describe("bookmarkletFor", () => {
  it("is a javascript: URL that appends the bridge script from War Room's origin", () => {
    const url = bookmarkletFor("https://draftroom.online");
    expect(url.startsWith("javascript:")).toBe(true);
    const appended: { src: string }[] = [];
    const context = vm.createContext({
      Date: { now: () => 123 },
      document: { createElement: () => ({ src: "" }), body: { appendChild: (el: { src: string }) => appended.push(el) } },
    });
    vm.runInContext(url.slice("javascript:".length), context);
    expect(appended).toEqual([{ src: "https://draftroom.online/espn-bridge.js?t=123" }]);
  });
});
