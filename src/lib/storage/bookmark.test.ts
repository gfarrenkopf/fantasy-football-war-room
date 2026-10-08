import { describe, expect, it } from "vitest";
import { hasWorkingBookmark, readSetupStep, setWorkingBookmark, writeSetupStep } from "./bookmark";
import { memoryStorage } from "./testing";

describe("the ESPN bookmark's setup on this device (APE-333)", () => {
  it("remembers a bookmark that worked here, until it's forgotten", () => {
    const storage = memoryStorage();
    expect(hasWorkingBookmark(storage)).toBe(false);
    setWorkingBookmark(true, storage);
    expect(hasWorkingBookmark(storage)).toBe(true);
    setWorkingBookmark(false, storage);
    expect(hasWorkingBookmark(storage)).toBe(false);
  });

  it("picks the steps up where this tab left them, only for the same steps", () => {
    const storage = memoryStorage();
    expect(readSetupStep("ios-safari", storage)).toBeNull();
    writeSetupStep("ios-safari", "save-2", storage);
    expect(readSetupStep("ios-safari", storage)).toBe("save-2");
    expect(readSetupStep("android", storage)).toBeNull();
    writeSetupStep("ios-safari", null, storage);
    expect(readSetupStep("ios-safari", storage)).toBeNull();
  });

  it("carries on without storage, or with junk in it", () => {
    expect(hasWorkingBookmark(null)).toBe(false);
    setWorkingBookmark(true, null);
    const storage = memoryStorage();
    storage.setItem("fwr:v1:bookmark-setup-step", "{not json");
    expect(readSetupStep("ios-safari", storage)).toBeNull();
  });
});
