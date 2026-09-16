import Anthropic from "@anthropic-ai/sdk";
import { PlanModelError, type ModelUsage, type PlanModel } from "../provider";

/** Chosen over Haiku 4.5 on plan quality (APE-99 evals): about $0.15 a plan, but it thinks, so allow minutes. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";

/** Models that reject `output_config.effort`. Everything newer accepts low / medium / high. */
const NO_EFFORT = ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1", "claude-opus-4-0", "claude-sonnet-4-0", "claude-3"];
const supportsEffort = (model: string) => !NO_EFFORT.some((prefix) => model.startsWith(prefix));

/** Claude, through the official SDK's structured outputs. The key is passed in; this module never reads env. */
export function createAnthropicPlanModel({ apiKey, model = ANTHROPIC_DEFAULT_MODEL }: { apiKey: string; model?: string }): PlanModel {
  const client = new Anthropic({ apiKey, maxRetries: 1 });

  return {
    provider: "anthropic",
    model,
    async generate({ system, user, schema, maxTokens, effort, signal }) {
      let response: Anthropic.Message;
      try {
        // Streamed: models that think first can take minutes, which a plain request may not survive.
        response = await client.messages
          .stream(
            {
              model,
              max_tokens: maxTokens,
              system,
              messages: [{ role: "user", content: user }],
              output_config: {
                format: { type: "json_schema", schema },
                ...(effort && supportsEffort(model) ? { effort } : {}),
              },
            },
            { signal },
          )
          .finalMessage();
      } catch (err) {
        if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
          throw new PlanModelError("timeout", "Claude request timed out", undefined, { cause: err });
        }
        const detail = err instanceof Anthropic.APIError ? `${err.status ?? "network"} ${err.message}` : String(err);
        throw new PlanModelError("unavailable", `Claude request failed: ${detail}`, undefined, { cause: err });
      }

      const usage: ModelUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
      };
      if (response.stop_reason === "refusal") throw new PlanModelError("refused", "Claude declined to write the plan", usage);
      if (response.stop_reason === "max_tokens") throw new PlanModelError("truncated", `Plan output passed ${maxTokens} tokens`, usage);

      const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      try {
        return { json: JSON.parse(text), usage };
      } catch (err) {
        throw new PlanModelError("invalid_output", "Claude's plan wasn't valid JSON", usage, { cause: err });
      }
    },
  };
}
