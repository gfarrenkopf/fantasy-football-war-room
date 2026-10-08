import { ESPN_FANTASY_HOME } from "@/lib/espn/pages";

/** A league the user has connected, and its ESPN page that stays in the browser (APE-303). */
export interface EspnLeagueLink {
  name: string;
  season: number;
  url: string;
}

/** The arrow out to another site, drawn to match the setup illustrations' stroke. */
function OutArrow() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 2.5h5v5M9.5 2.5 3 9" />
    </svg>
  );
}

/**
 * The user's ESPN leagues, one card each, ready to open on ESPN (APE-335). A card names the league on
 * its own line and leaves the action to the arrow, so a league called "ESPN" can't read as "Open ESPN
 * on ESPN". The last card opens ESPN Fantasy for any other league, or for the first one.
 */
export function EspnLeagueCards({ leagues }: { leagues: EspnLeagueLink[] }) {
  const card =
    "group flex min-h-14 items-center gap-3 rounded-card border border-line bg-panel px-4 py-3 no-underline text-text transition-colors hover:border-line2 hover:bg-panel2 focus-visible:outline-2 focus-visible:outline-focus";
  return (
    <ul className="space-y-2">
      {leagues.map((l) => (
        <li key={l.url}>
          <a href={l.url} className={card}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold">{l.name}</span>
              <span className="block text-muted">{l.season} season on ESPN</span>
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-sky">
              Open on ESPN <OutArrow />
            </span>
          </a>
        </li>
      ))}
      <li>
        <a href={ESPN_FANTASY_HOME} className={card}>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{leagues.length ? "Another league" : "Your league"}</span>
            <span className="block text-muted">Sign in to ESPN Fantasy, then open the league</span>
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-sky">
            ESPN Fantasy <OutArrow />
          </span>
        </a>
      </li>
    </ul>
  );
}
