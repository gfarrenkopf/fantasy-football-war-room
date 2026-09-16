import type { Instrumentation } from "next";
import { formatServerError } from "@/lib/server/errorLog";

/** Logs every server error Next captures as one tagged line, which the droplet's alert job watches. */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(formatServerError(error, request, context));
};
