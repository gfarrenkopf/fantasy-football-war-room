import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const CLOUD = { DATABASE_URL: "postgres://localhost/warroom", NEXTAUTH_SECRET: "secret" };
const STRIPE = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_PRICE_ID: "price_x" };

/** Imports a fresh config with exactly these variables set, and the warnings it logged. */
async function load(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { config } = await import("./config");
  return { config, warnings: warn.mock.calls.map(([line]) => String(line)) };
}

describe("payments config", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const name of [...Object.keys(CLOUD), ...Object.keys(STRIPE)]) vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is off with no variables set, and says nothing", async () => {
    const { config, warnings } = await load({});
    expect(config.paymentsEnabled).toBe(false);
    expect(warnings.filter((w) => /stripe|payments/i.test(w))).toEqual([]);
  });

  it("is on with cloud features and all three Stripe variables", async () => {
    const { config } = await load({ ...CLOUD, ...STRIPE });
    expect(config.paymentsEnabled).toBe(true);
  });

  it.each(Object.keys(STRIPE))("stays off and names %s when only it is missing", async (missing) => {
    const env: Record<string, string> = { ...CLOUD, ...STRIPE };
    delete env[missing];
    const { config, warnings } = await load(env);
    expect(config.paymentsEnabled).toBe(false);
    expect(warnings.some((w) => w.includes(missing) && w.includes("payments are off"))).toBe(true);
  });

  it("stays off with only the secret key set", async () => {
    const { config, warnings } = await load({ ...CLOUD, STRIPE_SECRET_KEY: "sk_test_x" });
    expect(config.paymentsEnabled).toBe(false);
    expect(warnings.some((w) => w.includes("STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID are not set"))).toBe(true);
  });

  it("stays off without cloud features", async () => {
    const { config, warnings } = await load(STRIPE);
    expect(config.paymentsEnabled).toBe(false);
    expect(warnings.some((w) => w.includes("cloud features are disabled, so payments are off"))).toBe(true);
  });
});

describe("Sign in with Apple config", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const APPLE = {
    AUTH_APPLE_ID: "tech.apeman.draftroom.web",
    AUTH_APPLE_TEAM_ID: "TEAM123456",
    AUTH_APPLE_KEY_ID: "KEY1234567",
    // As it sits in an .env file: one line, with \n escapes.
    AUTH_APPLE_PRIVATE_KEY: pem.replace(/\n/g, "\\n"),
  };

  beforeEach(() => {
    vi.resetModules();
    for (const name of [...Object.keys(CLOUD), ...Object.keys(APPLE)]) vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is off with no variables set, and says nothing about Apple", async () => {
    const { config, warnings } = await load({});
    expect(config.appleAuthEnabled).toBe(false);
    expect(warnings.filter((w) => /AUTH_APPLE/.test(w) && !/no sign-in method/.test(w))).toEqual([]);
  });

  it("is on with cloud features and all four variables, unescaping the key", async () => {
    const { config } = await load({ ...CLOUD, ...APPLE });
    expect(config.appleAuthEnabled).toBe(true);
    expect(config.applePrivateKey).toBe(pem.trim());
  });

  it("stays off and names what's missing in a partial setup", async () => {
    const { config, warnings } = await load({ ...CLOUD, AUTH_APPLE_ID: APPLE.AUTH_APPLE_ID, AUTH_APPLE_TEAM_ID: APPLE.AUTH_APPLE_TEAM_ID });
    expect(config.appleAuthEnabled).toBe(false);
    expect(warnings.some((w) => w.includes("AUTH_APPLE_KEY_ID, AUTH_APPLE_PRIVATE_KEY are not set, so Sign in with Apple is off"))).toBe(true);
  });

  it("stays off, and says why, when the key isn't a valid .p8", async () => {
    const { config, warnings } = await load({ ...CLOUD, ...APPLE, AUTH_APPLE_PRIVATE_KEY: "not a key" });
    expect(config.appleAuthEnabled).toBe(false);
    expect(warnings.some((w) => w.includes("AUTH_APPLE_PRIVATE_KEY isn't the PEM"))).toBe(true);
  });

  it("stays off without cloud features", async () => {
    const { config } = await load(APPLE);
    expect(config.appleAuthEnabled).toBe(false);
  });
});
