import Link from "next/link";
import { stage } from "@/components/draft/stageFont";
import s from "./appBar.module.css";

/**
 * The app bar (Epic 15): one row on top of every page, the draft room and the season page alike.
 * The wordmark on the left, the league you're in beside it, and on the right ESPN's sync time (on a
 * league that follows ESPN) and the account. Each page passes its own pieces; the bar only lays
 * them out, so it looks and behaves the same wherever it's mounted. On a phone the draft room also
 * passes its status chip (APE-322), so where the draft is costs no row of its own.
 */
export function AppBar({ league, status, sync, account }: { league?: React.ReactNode; status?: React.ReactNode; sync?: React.ReactNode; account?: React.ReactNode }) {
  return (
    <header className={`${s.bar} ${stage.variable}`}>
      <Link href="/" className={s.mark} aria-label="Draft Room home">
        <Mark />
        <span className={s.word} aria-hidden>
          Draft Room
        </span>
      </Link>
      {league && (
        <>
          <span className={s.rule} aria-hidden />
          <div className={s.league}>{league}</div>
        </>
      )}
      <div className={s.end}>
        {status}
        {sync}
        {account}
      </div>
    </header>
  );
}

/** The mark (src/app/icon.svg) without its tile: three board rows, and the one that's yours is lit. */
function Mark() {
  return (
    <svg viewBox="6 6 20 20" aria-hidden focusable="false">
      <rect x="6.5" y="6.5" width="19" height="5" rx="1.25" fill="var(--color-line2)" />
      <rect x="6.5" y="13.5" width="19" height="5" rx="1.25" fill="color-mix(in srgb, var(--color-mine) 30%, var(--color-bg))" />
      <rect x="6.5" y="13.5" width="3.5" height="5" rx="1.25" fill="var(--color-mine)" />
      <rect x="6.5" y="20.5" width="12" height="5" rx="1.25" fill="var(--color-line2)" />
    </svg>
  );
}

/** ESPN's last sync as a chip (the season page): the time, and a tap refreshes from ESPN. */
export function SyncChip({ time, stale, href }: { time: string; stale: boolean; href: string }) {
  const label = stale ? `ESPN isn't answering. Last synced${time ? ` at ${time}` : ""}. Refresh` : `Synced with ESPN${time ? ` at ${time}` : ""}. Refresh`;
  return (
    <a className={s.sync} href={href} data-stale={stale} aria-label={label} title={label}>
      <span className={s.syncLabel}>{stale ? "Last sync" : "Synced"}</span>
      {time && <span className={s.syncTime}>{time}</span>}
      <svg viewBox="0 0 16 16" aria-hidden focusable="false">
        <path d="M13.5 6.5A5.5 5.5 0 0 0 3.2 4.8M2.5 9.5a5.5 5.5 0 0 0 10.3 1.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M3 1.8v3.3h3.3M13 14.2v-3.3H9.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
