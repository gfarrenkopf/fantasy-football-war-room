import s from "./seasonLanding.module.css";

/**
 * Joins CSS-module class names; falsy entries are skipped and unknown names are ignored.
 * Bound to seasonLanding.module.css — landing/cx.ts is bound to landing.module.css and would
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
