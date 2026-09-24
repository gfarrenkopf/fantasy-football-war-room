/** Helpers the in-season AI outputs (lineup.ts, trade.ts) share. */

export const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

export const clip = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/** A ref the input never offered: the model is talking about someone who isn't in the tables. */
export const refError = (ref: string) => `names ${JSON.stringify(ref)}, which isn't in the input`;

const HEALTHY = new Set(["ACTIVE", "NORMAL", ""]);

/** ESPN's injury designation as the model sees it, or null for a healthy player. */
export const injuryTag = (status: string) => (HEALTHY.has(status) ? null : status.toLowerCase().replace(/_/g, " "));
