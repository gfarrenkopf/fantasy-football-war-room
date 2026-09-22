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
