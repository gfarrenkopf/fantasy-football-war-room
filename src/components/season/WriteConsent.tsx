import { ESPN_WRITE_DISCLOSURE } from "@/lib/espn/disclosure";
import s from "./season.module.css";

/** The consent to change the user's ESPN team, asked in the confirm step until they've agreed once. */
export function WriteConsent({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className={s.consent}>
      <ul>
        {ESPN_WRITE_DISCLOSURE.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <label className={s.check}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> I agree
      </label>
    </div>
  );
}
