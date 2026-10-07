import { AppBar } from "@/components/shell/AppBar";
import s from "@/components/season/season.module.css";

/** Shown while the season page reads the league from ESPN, which can take several seconds. */
export default function Loading() {
  return (
    <main className={s.root}>
      <AppBar />
      <div className={s.frame}>
        <header className={s.top}>
          <div className={s.titleBlock}>
            <p className={s.title}>Reading your league from ESPN…</p>
            <p className={s.meta}>Rosters, lineups and trades. ESPN can take a few seconds.</p>
          </div>
        </header>
      </div>
    </main>
  );
}
