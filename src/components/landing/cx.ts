import s from "./landing.module.css";

/**
 * Joins CSS-module class names; falsy entries are skipped and unknown names are ignored.
 * Bound to landing.module.css — the draft's cx() is bound to warRoom.module.css and would
 * silently drop every name from this one.
 */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names
    .filter((n): n is string => !!n)
    .map((n) => s[n])
    .filter(Boolean)
    .join(" ");
}

export { s };
