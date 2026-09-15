import s from "./warRoom.module.css";

/** Joins CSS-module class names; falsy entries are skipped and unknown names are ignored. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names
    .filter((n): n is string => !!n)
    .map((n) => s[n])
    .filter(Boolean)
    .join(" ");
}

export { s };
