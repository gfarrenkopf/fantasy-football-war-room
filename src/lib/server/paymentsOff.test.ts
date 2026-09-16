import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { getSessionUser } = vi.hoisted(() => ({ getSessionUser: vi.fn(async () => ({ userId: "u1", email: "a@example.test" })) }));
vi.mock("@/lib/auth", () => ({ getSessionUser }));

/**
 * With zero env vars (the self-hosted default) the payment routes answer a plain 404 JSON: no
 * Stripe client, no session lookup, no database.
 */
describe("payment routes with payments off", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const name of ["DATABASE_URL", "NEXTAUTH_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID"]) vi.stubEnv(name, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("checkout: POST /api/leagues/:id/checkout → 404", async () => {
    const { POST } = await import("@/app/api/leagues/[id]/checkout/route");
    const response = await POST(new Request("http://localhost/api/leagues/l1/checkout", { method: "POST" }), { params: Promise.resolve({ id: "l1" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(getSessionUser).not.toHaveBeenCalled();
  });

  it("checkout: 404 with cloud features on but Stripe unset", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/unused");
    vi.stubEnv("NEXTAUTH_SECRET", "secret");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { POST } = await import("@/app/api/leagues/[id]/checkout/route");
    const response = await POST(new Request("http://localhost/api/leagues/l1/checkout", { method: "POST" }), { params: Promise.resolve({ id: "l1" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});
