/** A webmail inbox the "check your inbox" state can open in one tap. */
export interface Mailbox {
  name: string;
  url: string;
}

/**
 * Gmail can go straight to the message, wherever it was filed: both subjects the sign-in email
 * uses (see email.ts) contain "war room", and `in:anywhere` includes Spam, where a first email
 * from a new sender often lands.
 */
const GMAIL = { name: "Gmail", url: "https://mail.google.com/mail/u/0/#search/subject%3A%22war+room%22+in%3Aanywhere+newer_than%3A1d" };
const OUTLOOK = { name: "Outlook", url: "https://outlook.live.com/mail/0/" };
const YAHOO = { name: "Yahoo Mail", url: "https://mail.yahoo.com/" };
const ICLOUD = { name: "iCloud Mail", url: "https://www.icloud.com/mail/" };
const PROTON = { name: "Proton Mail", url: "https://mail.proton.me/" };
const AOL = { name: "AOL Mail", url: "https://mail.aol.com/" };

const BY_DOMAIN: Record<string, Mailbox> = {
  "gmail.com": GMAIL,
  "googlemail.com": GMAIL,
  "outlook.com": OUTLOOK,
  "hotmail.com": OUTLOOK,
  "live.com": OUTLOOK,
  "msn.com": OUTLOOK,
  "yahoo.com": YAHOO,
  "ymail.com": YAHOO,
  "icloud.com": ICLOUD,
  "me.com": ICLOUD,
  "mac.com": ICLOUD,
  "proton.me": PROTON,
  "protonmail.com": PROTON,
  "pm.me": PROTON,
  "aol.com": AOL,
};

/** The webmail inbox for an address, or null when the domain isn't one we know (work mail, say). */
export function mailboxFor(email: string): Mailbox | null {
  const domain = email.trim().toLowerCase().split("@").pop();
  return (domain && BY_DOMAIN[domain]) || null;
}
