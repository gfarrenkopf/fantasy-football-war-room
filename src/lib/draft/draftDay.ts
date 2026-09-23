/**
 * When a league drafts: the optional `LeagueRecord.draftAt`, and how close it is.
 *
 * Stored in one of two shapes, so "the time is optional" survives the round trip:
 * - `"2026-09-27"`: a date only, meaning that calendar day wherever the viewer is;
 * - an ISO instant (`"2026-09-28T00:00:00.000Z"`): a date and time, the same moment everywhere.
 *
 * Nothing here reads the clock: `now` is passed in, so tests (and the goodbye, which renders
 * after a reload) decide what "now" is.
 */

export type DraftAt = { kind: "date"; year: number; month: number; day: number } | { kind: "time"; at: Date };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** An ISO date-time with an explicit zone, as Date#toISOString() and ESPN's epoch both give. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Reads a stored draftAt, or null when it's missing or isn't one of the two shapes. */
export function parseDraftAt(raw: unknown): DraftAt | null {
  if (typeof raw !== "string") return null;
  const d = DATE_ONLY.exec(raw);
  if (d) {
    const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
    const probe = new Date(year, month - 1, day);
    // Rejects 2026-02-31 and friends, which Date would quietly roll into March.
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
    return { kind: "date", year, month, day };
  }
  if (!INSTANT.test(raw)) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : { kind: "time", at };
}

/** True when `raw` is a storable draftAt. */
export const isDraftAt = (raw: unknown): raw is string => parseDraftAt(raw) !== null;

/**
 * The stored value for what the league setup form holds: a local date ("2026-09-27", from an
 * `<input type="date">`) and an optional local time ("20:00"). Null when there's no valid date.
 */
export function toDraftAt(date: string, time = ""): string | null {
  const d = parseDraftAt(date);
  if (!d || d.kind !== "date") return null;
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!t) return date;
  return new Date(d.year, d.month - 1, d.day, Number(t[1]), Number(t[2])).toISOString();
}

/** The form's two fields back from a stored value, in the viewer's own timezone. */
export function draftAtFields(raw: string | null | undefined): { date: string; time: string } {
  const d = parseDraftAt(raw);
  if (!d) return { date: "", time: "" };
  if (d.kind === "date") return { date: raw as string, time: "" };
  const p = (n: number) => String(n).padStart(2, "0");
  const at = d.at;
  return { date: `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`, time: `${p(at.getHours())}:${p(at.getMinutes())}` };
}

export type DraftPhase = "later" | "tomorrow" | "today" | "soon" | "started";

export interface DraftCountdown {
  phase: DraftPhase;
  /** Milliseconds until the draft: to the time when there is one, to the day's start when not. */
  ms: number;
  /** Whether a time was given. */
  timed: boolean;
  /** How far off, in words: "in 3 days", "tomorrow", "tonight", "today", "in 45 min", "now". */
  label: string;
  /** When, in words: "Sun, Sep 27", "Sun 8:00 PM", "8:00 PM". */
  when: string;
  /** The draft day, for sorting: the instant, or local midnight of the date. */
  at: Date;
}

const HOUR = 3_600_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Whole calendar days from `a` to `b` in local time, DST-safe. */
const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / (24 * HOUR));

const fmt = (opts: Intl.DateTimeFormatOptions, locale?: string) => new Intl.DateTimeFormat(locale, opts);

/**
 * How close the draft is. Date-only drafts count in days and are "today" from midnight; timed
 * ones go "soon" in the last hour and "started" once the time passes. Null when there's no date.
 */
export function draftCountdown(raw: string | null | undefined, now: Date, locale?: string): DraftCountdown | null {
  const d = parseDraftAt(raw);
  if (!d) return null;
  const timed = d.kind === "time";
  const at = timed ? d.at : new Date(d.year, d.month - 1, d.day);
  const ms = at.getTime() - now.getTime();
  const days = daysBetween(now, at);
  const time = timed ? fmt({ hour: "numeric", minute: "2-digit" }, locale).format(at) : "";
  const date = fmt({ weekday: "short", month: "short", day: "numeric" }, locale).format(at);
  const weekday = fmt({ weekday: "short" }, locale).format(at);

  let phase: DraftPhase;
  let label: string;
  if (timed ? ms <= 0 : days < 0) {
    phase = "started";
    label = "now";
  } else if (timed && ms < HOUR) {
    phase = "soon";
    const min = Math.ceil(ms / 60_000);
    label = min <= 1 ? "in a minute" : `in ${min} min`;
  } else if (days === 0) {
    phase = "today";
    label = timed && at.getHours() >= 17 ? "tonight" : "today";
  } else if (days === 1) {
    phase = "tomorrow";
    label = "tomorrow";
  } else {
    phase = "later";
    label = `in ${days} days`;
  }

  const when = !timed ? date : days <= 1 && days >= 0 ? time : days < 7 ? `${weekday} ${time}` : `${date}, ${time}`;
  return { phase, ms, timed, label, when, at };
}

/** A span as the countdown shows it: "3d 4h", "5h 12m", "12:04" in the last hour. */
export function formatSpan(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
