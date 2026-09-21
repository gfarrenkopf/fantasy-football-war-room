/**
 * The sign-in email: the first thing the product ever sends someone, so it looks like the room
 * they're about to walk into rather than Auth.js's generic template. Pure, so it can be tested.
 *
 * Email clients ignore stylesheets and CSS variables, so every color here is a literal copy of a
 * token in globals.css (named beside each one). That, and the filled green button, are the email's
 * exception to DESIGN.md: it's an off-app surface, and the button has to win in a crowded inbox.
 */

const C = {
  bg: "#1a1e25", // --color-bg
  panel: "#22272f", // --color-panel
  line: "#323a45", // --color-line
  text: "#e7ebf0", // --color-text
  muted: "#8f9aa8", // --color-muted
  dim: "#5f6a78", // --color-dim
  mine: "#3ddc91", // --color-mine
  mineInk: "#0d1a14", // --color-mine-ink
  sky: "#9be1ff", // --color-sky
} as const;

/** The six position hues, in draft-board order: the stripe across the top of the card. */
const STRIPE = ["#e5484d", "#3ddc91", "#4f9cf9", "#f59e42", "#b39ddb", "#9aa7b8"];

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface SignInEmailInput {
  /** The magic link. */
  url: string;
  /** The address the link was requested for. */
  email: string;
  /** No account exists for this address yet: this email is someone's sign-up. */
  isNew: boolean;
  /** How long the link lasts, in hours. */
  hours: number;
}

export interface SignInEmail {
  subject: string;
  html: string;
  text: string;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * A zero-width space after each dot and @, so Gmail and Apple Mail don't turn the address into a
 * link of its own that competes with the real one.
 */
const unlinked = (s: string) => escape(s).replace(/([.@])/g, "$1&#8203;");

export function renderSignInEmail({ url, email, isNew, hours }: SignInEmailInput): SignInEmail {
  const copy = isNew
    ? {
        subject: "Your seat in the war room is ready",
        preheader: "One tap and your board is saved to your account.",
        headline: "Your seat is ready.",
        body: "Tap below to finish signing up. Your leagues sync to your account and follow you to every device you sign in on.",
        cta: "Enter the war room",
      }
    : {
        subject: "Back to the war room",
        preheader: "Your sign-in link is inside.",
        headline: "Back to the war room.",
        body: "Tap below to sign in. Your leagues sync to every device you sign in on.",
        cta: "Sign in",
      };
  const life = hours === 1 ? "1 hour" : `${hours} hours`;
  const href = escape(url);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escape(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};" bgcolor="${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};">${escape(copy.preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" style="padding:40px 16px;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:480px;">
    <tr><td style="padding:0 4px 14px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:2px;color:${C.muted};">
      <span style="color:${C.mine};">&#9679;</span>&nbsp; FANTASY WAR ROOM
    </td></tr>
    <tr><td bgcolor="${C.panel}" style="background:${C.panel};border:1px solid ${C.line};border-radius:10px;overflow:hidden;">
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
        ${STRIPE.map((c) => `<td height="4" bgcolor="${c}" style="height:4px;line-height:4px;font-size:0;background:${c};">&nbsp;</td>`).join("")}
      </tr></table>
      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr><td style="padding:32px 32px 0;font-family:${FONT};font-size:26px;line-height:32px;font-weight:700;color:${C.text};">${escape(copy.headline)}</td></tr>
        <tr><td style="padding:12px 32px 0;font-family:${FONT};font-size:15px;line-height:23px;color:${C.muted};">${escape(copy.body)}</td></tr>
        <tr><td style="padding:28px 32px 0;">
          <table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr>
            <td align="center" bgcolor="${C.mine}" style="border-radius:6px;background:${C.mine};">
              <a href="${href}" target="_blank" style="display:inline-block;padding:15px 28px;font-family:${FONT};font-size:16px;line-height:18px;font-weight:700;color:${C.mineInk};text-decoration:none;border-radius:6px;">${escape(copy.cta)} &rarr;</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 32px 0;"><div style="height:1px;line-height:1px;font-size:0;background:${C.line};">&nbsp;</div></td></tr>
        <tr><td style="padding:18px 32px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">
          This link signs in <span style="color:${C.text};">${unlinked(email)}</span>. It works once and expires in ${life}.
        </td></tr>
        <tr><td style="padding:10px 32px 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">
          Button not working? Paste this into your browser:<br>
          <a href="${href}" target="_blank" style="color:${C.sky};word-break:break-all;">${href}</a>
        </td></tr>
        <tr><td style="padding:10px 32px 30px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.dim};">
          Didn't ask for this? Ignore it. Nobody gets in without the link.
        </td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;

  const text = [
    copy.headline,
    "",
    copy.body,
    "",
    `${copy.cta}:`,
    url,
    "",
    `This link signs in ${email}. It works once and expires in ${life}.`,
    "Didn't ask for this? Ignore it. Nobody gets in without the link.",
    "",
    "Fantasy War Room",
    "",
  ].join("\n");

  return { subject: copy.subject, html, text };
}
