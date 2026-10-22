import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanModelError } from "../provider";
import { createAnthropicPlanModel } from "./anthropic";

/** What the next streamed request fails with. */
let failure: unknown;

// The SDK's own error classes, around a client whose every request fails with `failure`.
vi.mock("@anthropic-ai/sdk", async (importActual) => {
  const actual = (await importActual<typeof import("@anthropic-ai/sdk")>()).default;
  class FakeAnthropic {
    static APIError = actual.APIError;
    static APIUserAbortError = actual.APIUserAbortError;
    static APIConnectionTimeoutError = actual.APIConnectionTimeoutError;
    messages = { stream: () => ({ finalMessage: () => Promise.reject(failure) }) };
  }
  return { default: FakeAnthropic };
});

const { default: Anthropic } = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");

const request = { system: "system", user: "the prompt", schema: {}, maxTokens: 100 };

async function failed(): Promise<PlanModelError> {
  const error = await createAnthropicPlanModel({ apiKey: "sk-ant-secret" })
    .generate(request)
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PlanModelError);
  return error as PlanModelError;
}

describe("createAnthropicPlanModel failures", () => {
  beforeEach(() => {
    failure = undefined;
  });

  it("carries an expired key's status and type", async () => {
    failure = Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, undefined, new Headers());
    const error = await failed();
    expect(error.kind).toBe("unavailable");
    expect(error.detail).toEqual({ status: 401, type: "authentication_error", message: "invalid x-api-key" });
    expect(error.message).toBe("Claude request failed: 401 invalid x-api-key");
    expect(JSON.stringify(error.detail)).not.toContain("sk-ant-secret");
  });

  it("carries an overload's status", async () => {
    failure = Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers());
    expect((await failed()).detail).toEqual({ status: 529, type: "overloaded_error", message: "Overloaded" });
  });

  it("calls a timeout a timeout", async () => {
    failure = new Anthropic.APIConnectionTimeoutError();
    const error = await failed();
    expect(error.kind).toBe("timeout");
    expect(error.detail).toEqual({ type: "timeout", message: "Claude request timed out" });
  });

  it("keeps a network failure's message, without a status", async () => {
    failure = new Error("socket hang up");
    expect((await failed()).detail).toEqual({ message: "Error: socket hang up" });
  });
});
