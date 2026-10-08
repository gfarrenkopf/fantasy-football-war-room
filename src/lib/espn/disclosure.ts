/**
 * What Draft Room tells a user before they connect ESPN, and its version: one consent for both the
 * live draft (8.7) and the season login (10.2), asked once per account at whichever connect comes
 * first (APE-332). Bump the version whenever the substance changes: everyone sees it again before
 * their next connect. Version 3 folded the season login into what was the draft's own disclosure.
 *
 * Every text in this file renamed War Room to Draft Room, and ESPN's "draft room" to "ESPN draft"
 * (APE-316). That changed the name, not the substance, so no version here was bumped.
 */
export const ESPN_DISCLOSURE_VERSION = 3;

export const ESPN_DISCLOSURE: readonly string[] = [
  "Connecting to ESPN is unofficial. It isn't made, endorsed or supported by ESPN, and it can stop working without notice if ESPN changes things. Your Draft Room board always works by hand.",
  "During your draft, it reads your open ESPN draft page to see picks as they're made. Only draft data (picks, the draft clock, league settings) is sent to Draft Room.",
  "When you draft a player from Draft Room, it makes that pick in your ESPN draft for you, only while you're on the clock. It never picks on its own.",
  "For the season, your ESPN tab hands Draft Room your ESPN login cookies (not your password), so Draft Room can read your leagues: your lineup each week, and trades weighed against everyone's real rosters.",
  "Draft Room stores those cookies encrypted and uses them only to read your leagues. It never changes anything on ESPN unless you ask it to and confirm, and it deletes them when the season ends or when you disconnect.",
];

/**
 * The separate opt-in for handing War Room the ESPN draft room's join code (9.1), shown in the
 * bridge overlay. Deliberately not folded into the disclosure above: it's a credential, and taking
 * over costs the user their own ESPN draft room's connection. Bump the version when the substance changes.
 */
export const ESPN_HANDOVER_VERSION = 1;

export const ESPN_HANDOVER_DISCLOSURE: readonly string[] = [
  "Let Draft Room join your ESPN draft itself, so you can draft from Draft Room on your phone with no ESPN tab open anywhere.",
  "This tab hands Draft Room your ESPN draft's join code. Draft Room stores it encrypted and deletes it when the draft completes, or after 12 hours if it never does.",
  "ESPN allows one connection per team. When you tell Draft Room to take over, your ESPN draft disconnects on every device until you hand back.",
  "Draft Room still only picks players you choose, and only while you're on the clock.",
];

/**
 * The consent to change the user's team on ESPN: the lineup (12.1), then IR, adds and drops, waiver
 * claims and trades (Epic 13). Asked the first time they confirm a change on the season page.
 * Separate from the season login above, which only ever reads. Bump the version when the substance
 * changes: version 2 widened it from the lineup to the whole team.
 */
export const ESPN_WRITE_VERSION = 2;

export const ESPN_WRITE_DISCLOSURE: readonly string[] = [
  "Draft Room may change your team on ESPN when you confirm a change: your lineup, IR, adds and drops, waiver claims, and trade offers and replies.",
  "It only makes the changes you've just reviewed, only for your own team, and never on its own: not from the Sunday email, not from the AI.",
  "Right before it writes, it re-reads ESPN and stops if anything has changed or a player's game has started. Afterwards it reads ESPN again and shows you what went through.",
  "It's unofficial and can stop working if ESPN changes things. Your team on ESPN is always yours to check.",
];
