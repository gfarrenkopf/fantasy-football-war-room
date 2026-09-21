import { describe, expect, it } from "vitest";
import { mailboxFor } from "./mailbox";

describe("mailboxFor", () => {
  it("knows the big webmail providers", () => {
    expect(mailboxFor("fan@gmail.com")?.name).toBe("Gmail");
    expect(mailboxFor("fan@googlemail.com")?.name).toBe("Gmail");
    expect(mailboxFor("fan@hotmail.com")?.name).toBe("Outlook");
    expect(mailboxFor("fan@yahoo.com")?.name).toBe("Yahoo Mail");
    expect(mailboxFor("fan@me.com")?.name).toBe("iCloud Mail");
    expect(mailboxFor("fan@proton.me")?.name).toBe("Proton Mail");
  });

  it("ignores case and surrounding space", () => {
    expect(mailboxFor("  Fan@GMAIL.com ")?.name).toBe("Gmail");
  });

  it("searches Gmail everywhere, spam included", () => {
    expect(mailboxFor("fan@gmail.com")?.url).toContain("in%3Aanywhere");
  });

  it("returns null for domains it doesn't know", () => {
    expect(mailboxFor("fan@apeman.tech")).toBeNull();
    expect(mailboxFor("not an email")).toBeNull();
  });
});
