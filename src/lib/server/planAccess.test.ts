import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAN_ALLOWANCE } from "./aiPlans";
import { decidePlanAccess } from "./planAccess";

const allowed = { kind: "allowed", allowance: DEFAULT_PLAN_ALLOWANCE };
const entitled = (value: boolean) => vi.fn(async () => value);

describe("decidePlanAccess", () => {
  describe("payments off (self-hosted)", () => {
    it("allows everyone when there's no allowlist, without looking up purchases", async () => {
      const isEntitled = entitled(false);
      expect(await decidePlanAccess({ paymentsEnabled: false, allowlist: [], email: null, isEntitled })).toEqual(allowed);
      expect(isEntitled).not.toHaveBeenCalled();
    });

    it("limits AI plans to the allowlist when there is one", async () => {
      const allowlist = ["owner@example.test"];
      expect(await decidePlanAccess({ paymentsEnabled: false, allowlist, email: "Owner@Example.test", isEntitled: entitled(false) })).toEqual(allowed);
      expect(await decidePlanAccess({ paymentsEnabled: false, allowlist, email: "someone@example.test", isEntitled: entitled(true) })).toEqual({ kind: "not-allowed" });
      expect(await decidePlanAccess({ paymentsEnabled: false, allowlist, email: null, isEntitled: entitled(true) })).toEqual({ kind: "not-allowed" });
    });
  });

  describe("payments on (hosted)", () => {
    it("needs a season pass", async () => {
      expect(await decidePlanAccess({ paymentsEnabled: true, allowlist: [], email: "a@example.test", isEntitled: entitled(false) })).toEqual({ kind: "needs-purchase" });
      expect(await decidePlanAccess({ paymentsEnabled: true, allowlist: [], email: "a@example.test", isEntitled: entitled(true) })).toEqual(allowed);
    });

    it("lets allowlisted emails skip the paywall, and an empty allowlist lets nobody skip it", async () => {
      const isEntitled = entitled(false);
      expect(await decidePlanAccess({ paymentsEnabled: true, allowlist: ["owner@example.test"], email: "owner@example.test", isEntitled })).toEqual(allowed);
      expect(isEntitled).not.toHaveBeenCalled();
      expect(await decidePlanAccess({ paymentsEnabled: true, allowlist: ["owner@example.test"], email: "a@example.test", isEntitled })).toEqual({ kind: "needs-purchase" });
      expect(await decidePlanAccess({ paymentsEnabled: true, allowlist: [], email: null, isEntitled })).toEqual({ kind: "needs-purchase" });
    });
  });
});
