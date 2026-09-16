/**
 * One-line log records for server errors, written by `onRequestError` in src/instrumentation.ts.
 * On the hosted droplet, deploy/warroom-alerts.sh emails any line starting with SERVER_ERROR_TAG.
 */

export const SERVER_ERROR_TAG = "[server-error]";

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
