import { describe, expect, it, vi } from "vitest";
import { decideEspnAccess } from "./espnAccess";

const entitled = (value: boolean) => vi.fn(async () => value);

describe("decideEspnAccess", () => {
  it("limits the beta to the allowlist, season pass or not, without looking up purchases", async () => {
    const allowlist = ["owner@example.test"];
    const isEntitled = entitled(true);
    for (const paymentsEnabled of [false, true]) {
      expect(await decideEspnAccess({ paymentsEnabled, allowlist, email: "Owner@Example.test", isEntitled })).toEqual({ kind: "allowed" });
      expect(await decideEspnAccess({ paymentsEnabled, allowlist, email: "fan@example.test", isEntitled })).toEqual({ kind: "not-allowed" });
      expect(await decideEspnAccess({ paymentsEnabled, allowlist, email: null, isEntitled })).toEqual({ kind: "not-allowed" });
    }
    expect(isEntitled).not.toHaveBeenCalled();
  });

  it("needs the league's season pass once the beta opens and payments are on", async () => {
    expect(await decideEspnAccess({ paymentsEnabled: true, allowlist: [], email: "a@example.test", isEntitled: entitled(false) })).toEqual({ kind: "needs-purchase" });
    expect(await decideEspnAccess({ paymentsEnabled: true, allowlist: [], email: "a@example.test", isEntitled: entitled(true) })).toEqual({ kind: "allowed" });
  });

  it("allows everyone when payments are off and there's no beta", async () => {
    const isEntitled = entitled(false);
    expect(await decideEspnAccess({ paymentsEnabled: false, allowlist: [], email: null, isEntitled })).toEqual({ kind: "allowed" });
    expect(isEntitled).not.toHaveBeenCalled();
  });
});
