/**
 * The ESPN bookmark's setup on this device (APE-333). Bookmarks live in a browser, not an account,
 * so whether one works here is a device fact: a new phone gets the setup steps again, which is right.
 * Both are conveniences, like Opening Night's premiered leagues: lost storage only means the steps
 * show again, or start over from the top.
 */

const WORKS = "fwr:v1:bookmark-works";
/** Where the setup steps were, for this tab: some browsers reload the page while a bookmark is edited. */
const STEP = "fwr:v1:bookmark-setup-step";

function store(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return typeof window === "undefined" ? null : window[kind];
  } catch {
    return null;
  }
}

/** The bookmark ran here, in the setup steps' test, so this browser has a working one. */
export function hasWorkingBookmark(storage: Storage | null = store("localStorage")): boolean {
  try {
    return storage?.getItem(WORKS) === "1";
  } catch {
    return false;
  }
}

export function setWorkingBookmark(works: boolean, storage: Storage | null = store("localStorage")): void {
  try {
    if (works) storage?.setItem(WORKS, "1");
    else storage?.removeItem(WORKS);
  } catch {
    // Blocked storage: the setup steps show again next time.
  }
}

/** The setup step this tab was on, if it's the step list it was on (`flow`), or null. */
export function readSetupStep(flow: string, storage: Storage | null = store("sessionStorage")): string | null {
  try {
    const saved = JSON.parse(storage?.getItem(STEP) ?? "null") as { flow?: unknown; step?: unknown } | null;
    return saved && saved.flow === flow && typeof saved.step === "string" ? saved.step : null;
  } catch {
    return null;
  }
}

export function writeSetupStep(flow: string, step: string | null, storage: Storage | null = store("sessionStorage")): void {
  try {
    if (step === null) storage?.removeItem(STEP);
    else storage?.setItem(STEP, JSON.stringify({ flow, step }));
  } catch {
    // Blocked storage: a reload starts the steps over.
  }
}
