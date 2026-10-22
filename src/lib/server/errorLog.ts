/**
 * One-line log records for server errors, written by `onRequestError` in src/instrumentation.ts,
 * and for failed AI calls. On the hosted droplet, deploy/warroom-alerts.sh emails any line starting
 * with SERVER_ERROR_TAG, and AI_ERROR_TAG lines that show a bad key or a streak of one failure.
 */

import type { PlanModelErrorKind, ModelErrorDetail } from "@/lib/ai/provider";

export const SERVER_ERROR_TAG = "[server-error]";
export const AI_ERROR_TAG = "[ai-error]";

/** The fields of Next's `onRequestError` arguments this reads. */
export interface ErrorRequest {
  path: string;
  method: string;
}
export interface ErrorContext {
  routePath: string;
  routeType: string;
}

const MAX_MESSAGE = 500;

/**
 * Formats a server error as a single JSON line. The query string is dropped because it can carry
 * sign-in tokens and email addresses, and headers are never included. Stack traces stay in Next's
 * own log output next to this line.
 */
export function formatServerError(error: unknown, request: ErrorRequest, context: ErrorContext): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  const record = {
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    type: context.routeType,
    message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message,
    digest,
  };
  return `${SERVER_ERROR_TAG} ${JSON.stringify(record)}`;
}

/** The call a failed model request was for. */
export interface AiCall {
  purpose: string;
  provider: string;
  model: string;
}

/**
 * Formats a failed model call as one greppable line (APE-427):
 * `[ai-error] purpose=season-trade-ideas provider=anthropic model=claude-sonnet-5 kind=unavailable status=401 type=authentication_error message="invalid x-api-key"`.
 * Status and type appear only when the provider gave them. Never the key or the prompt.
 */
export function formatAiError(call: AiCall, kind: PlanModelErrorKind | "internal", detail?: ModelErrorDetail): string {
  const fields = [
    `purpose=${call.purpose}`,
    `provider=${call.provider}`,
    `model=${call.model}`,
    `kind=${kind}`,
    detail?.status !== undefined ? `status=${detail.status}` : null,
    detail?.type ? `type=${detail.type}` : null,
    detail ? `message=${JSON.stringify(detail.message.length > MAX_MESSAGE ? `${detail.message.slice(0, MAX_MESSAGE)}…` : detail.message)}` : null,
  ];
  return `${AI_ERROR_TAG} ${fields.filter((f) => f !== null).join(" ")}`;
}
