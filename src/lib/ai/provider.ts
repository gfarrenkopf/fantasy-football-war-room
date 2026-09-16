/**
 * The seam between the AI plan and whichever model writes it. Everything else (prompt, schema,
 * validation, caching, rate limits, cost logging) depends on this interface only, never on a
 * vendor SDK. Each vendor is one adapter in ./providers.
 */

export type JsonSchema = Record<string, unknown>;

export interface ModelUsage {
  /** Input tokens billed at the full rate. */
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the provider's prompt cache, when it reports them. */
  cachedInputTokens?: number;
}

export interface ModelRequest {
  system: string;
  user: string;
  /** JSON Schema the response must follow. Adapters use the provider's structured-output mode. */
  schema: JsonSchema;
  maxTokens: number;
  /**
   * How hard a model that reasons should think. Adapters map it to the provider's own setting, and
   * ignore it for models without one.
   */
  effort?: ModelEffort;
  signal?: AbortSignal;
}

export type ModelEffort = "low" | "medium" | "high";

export interface ModelResponse {
  /** The parsed JSON body. Not yet validated against the schema. */
  json: unknown;
  usage: ModelUsage;
}

export interface PlanModel {
  provider: string;
  model: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export type PlanModelErrorKind =
  /** The provider couldn't be reached or returned an error. */
  | "unavailable"
  /** The request was aborted or ran past its deadline. */
  | "timeout"
  /** The model declined to answer. */
  | "refused"
  /** The output hit the token limit before finishing. */
  | "truncated"
  /** The output wasn't parseable JSON. */
  | "invalid_output";

export class PlanModelError extends Error {
  readonly kind: PlanModelErrorKind;
  /** Tokens spent before the failure, when the provider reported them. */
  readonly usage?: ModelUsage;

  // No parameter properties: the CLIs run this file under Node's strip-only TypeScript.
  constructor(kind: PlanModelErrorKind, message: string, usage?: ModelUsage, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlanModelError";
    this.kind = kind;
    this.usage = usage;
  }
}
