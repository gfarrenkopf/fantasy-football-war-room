/**
 * Who may use in-season features (Epic 10). The free tier is for every signed-in user, except while
 * ESPN_SYNC_ALLOWLIST is set: then, as for live draft sync's beta, only those accounts. That keeps
 * in-season to the dogfooding accounts until launch.
 */
export function mayUseSeason(allowlist: readonly string[], email: string | null): boolean {
  return allowlist.length === 0 || (!!email && allowlist.includes(email.toLowerCase()));
}
