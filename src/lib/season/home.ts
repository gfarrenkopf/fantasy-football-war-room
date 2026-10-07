/** Where picking a league lands (Epic 15): its season page once it's linked and drafted, its draft room before. */
export function leagueHome(id: string, linked: boolean, draftDone: boolean): string {
  return linked && draftDone ? `/season/${encodeURIComponent(id)}` : `/draft?league=${encodeURIComponent(id)}`;
}
