/**
 * What War Room tells a user before they connect an ESPN draft (8.7), and its version. Bump the
 * version whenever the substance changes: everyone sees it again before their next pairing.
 */
export const ESPN_DISCLOSURE_VERSION = 2;

export const ESPN_DISCLOSURE: readonly string[] = [
  "ESPN live sync is unofficial. It isn't made, endorsed or supported by ESPN.",
  "It reads your open ESPN draft page to see picks as they're made.",
  "When you draft a player from War Room, it makes that pick in your ESPN draft room for you, only while you're on the clock. It never picks on its own.",
  "Only draft data (picks, the draft clock, league settings) is sent to War Room. War Room never sees your ESPN password or cookies.",
  "It's best-effort and can stop working without notice if ESPN changes their draft room. Your War Room board always works by hand.",
];

/**
 * The separate opt-in for handing War Room the ESPN draft room's join code (9.1), shown in the
 * bridge overlay. Deliberately not folded into the disclosure above: it's a credential, and taking
 * over costs the user their own ESPN draft room's connection. Bump the version when the substance changes.
 */
export const ESPN_HANDOVER_VERSION = 1;

export const ESPN_HANDOVER_DISCLOSURE: readonly string[] = [
  "Let War Room join your ESPN draft room itself, so you can draft from War Room on your phone with no ESPN tab open anywhere.",
  "This tab hands War Room your draft room's join code. War Room stores it encrypted and deletes it when the draft completes, or after 12 hours if it never does.",
  "ESPN allows one connection per team. When you tell War Room to take over, your ESPN draft room disconnects on every device until you hand back.",
  "War Room still only picks players you choose, and only while you're on the clock.",
];

/**
 * The opt-in for handing War Room the user's ESPN login for the season (10.2), shown in the bridge
 * overlay before "Connect my season". A separate consent from both of the above: it's a long-lived
 * credential covering every league on the account. Bump the version when the substance changes.
 */
export const ESPN_SEASON_VERSION = 1;

export const ESPN_SEASON_DISCLOSURE: readonly string[] = [
  "Let War Room read your ESPN leagues during the season, so it can recommend your lineup each week and weigh trades against everyone's real rosters.",
  "This tab hands War Room your ESPN login cookies (not your password). War Room stores them encrypted, uses them only to read your leagues, and deletes them when the season ends or when you disconnect.",
  "War Room never changes anything on ESPN unless you ask it to and confirm.",
  "It's unofficial and can stop working if ESPN changes things. If ESPN signs you out, War Room asks you to click the bookmarklet again.",
];

/**
 * The consent to change the user's lineup on ESPN (12.1), asked the first time they press Apply on
 * the season page. Separate from the season login above, which only ever reads. Bump the version
 * when the substance changes.
 */
export const ESPN_LINEUP_WRITE_VERSION = 1;

export const ESPN_LINEUP_WRITE_DISCLOSURE: readonly string[] = [
  "War Room may change your lineup on ESPN when you press Apply.",
  "It only makes the moves you've just reviewed, only on your own team, and never on its own: not from the Sunday email, not from the AI.",
  "Right before it writes, it re-reads your roster from ESPN and stops if anything has changed or a player's game has started. Afterwards it reads ESPN again and shows you which moves landed.",
  "It's unofficial and can stop working if ESPN changes things. Your lineup on ESPN is always yours to check.",
];
