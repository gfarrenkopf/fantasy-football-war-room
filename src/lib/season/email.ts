import type { AiLineup } from "@/lib/ai/season/lineup";
import { C, escape, FONT, STRIPE } from "@/lib/auth/email";
import { compareLineups } from "./lineup";
import type { SeasonView } from "./view";

/**
 * The Sunday job's emails (11.3): "Your Sunday lineup is ready", and the one asking to reconnect
 * ESPN. Same look as the sign-in email (src/lib/auth/email.ts). Pure, so it can be tested.
 */

export interface LeagueSummary {
  name: string;
  /** The league's season page. */
  url: string;
  /** Projected points the AI lineup adds over the one set on ESPN now. */
  gain: number;
  /** The top changes to make on ESPN, in words. */
  moves: string[];
}

export interface SeasonEmail {
  subject: string;
  html: string;
  text: string;
}

const SLOT: Record<string, string> = { SUPERFLEX: "OP", DST: "D/ST" };

/** The changes from the lineup set on ESPN to the AI lineup, as "Start A at RB over B", most first. */
export function lineupMoves(view: SeasonView, lineup: AiLineup, max = 3): string[] {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const starting = new Set(lineup.slots.flatMap((s) => (s.playerId === null ? [] : [s.playerId])));
  const out = roster.filter((p) => p.slot !== "BN" && p.slot !== "IR" && !starting.has(p.playerId)).sort((a, b) => a.points - b.points);
  const ins = lineup.slots.filter((s) => s.playerId !== null && byId.get(s.playerId)?.slot === "BN");
  const moves = ins.map((s, i) => {
    const p = byId.get(s.playerId!)!;
    const benched = out[i];
    return { gain: p.points - (benched?.points ?? 0), text: `Start ${p.name} at ${SLOT[s.key] ?? s.key}${benched ? ` over ${benched.name}` : ""}` };
  });
  return moves
    .sort((a, b) => b.gain - a.gain)
    .slice(0, max)
    .map((m) => m.text);
}

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

function shell({ title, preheader, headline, body, footer }: { title: string; preheader: string; headline: string; body: string; footer: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};" bgcolor="${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};">${escape(preheader)}${"&#847;&zwnj;&nbsp;".repeat(40)}</div>
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
        <tr><td style="padding:32px 32px 0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;color:${C.text};">${escape(headline)}</td></tr>
        ${body}
        <tr><td style="padding:24px 32px 30px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.dim};">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;
}

const button = (href: string, label: string) => `<table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr>
            <td align="center" bgcolor="${C.mine}" style="border-radius:6px;background:${C.mine};">
              <a href="${escape(href)}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;line-height:18px;font-weight:700;color:${C.mineInk};text-decoration:none;border-radius:6px;">${escape(label)} &rarr;</a>
            </td>
          </tr></table>`;

const footer = (unsubscribeUrl: string) =>
  `You get this because you connected a league to War Room for the season. <a href="${escape(unsubscribeUrl)}" target="_blank" style="color:${C.muted};">Stop these emails</a>.`;

/** "Your Sunday lineup is ready": one section per league, with the moves that matter most. */
export function renderSundayEmail({ leagues, unsubscribeUrl }: { leagues: LeagueSummary[]; unsubscribeUrl: string }): SeasonEmail {
  const subject = leagues.length === 1 ? "Your Sunday lineup is ready" : `Your Sunday lineups are ready (${leagues.length} leagues)`;
  const lead = "Written after the inactives were posted. Set it on ESPN before kickoff.";
  const sections = leagues
    .map((l) => {
      const moves = l.moves.length
        ? `<ul style="margin:8px 0 0;padding-left:18px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.text};">${l.moves.map((m) => `<li>${escape(m)}</li>`).join("")}</ul>`
        : `<p style="margin:8px 0 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">Your ESPN lineup already matches it.</p>`;
      const gain = l.gain > 0.05 ? ` <span style="color:${C.mine};font-weight:700;">${escape(signed(l.gain))} pts</span>` : "";
      return `<tr><td style="padding:22px 32px 0;">
          <div style="font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:${C.text};">${escape(l.name)}${gain}</div>
          ${moves}
          <div style="padding-top:12px;">${button(l.url, "See the lineup")}</div>
        </td></tr>`;
    })
    .join("\n");
  const html = shell({
    title: subject,
    preheader: leagues[0]?.moves[0] ?? lead,
    headline: subject.startsWith("Your Sunday lineups") ? "Your Sunday lineups are ready." : "Your Sunday lineup is ready.",
    body: `<tr><td style="padding:10px 32px 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">${escape(lead)}</td></tr>\n${sections}`,
    footer: footer(unsubscribeUrl),
  });
  const text = [
    subject,
    "",
    lead,
    ...leagues.flatMap((l) => ["", `${l.name}${l.gain > 0.05 ? ` (${signed(l.gain)} pts)` : ""}`, ...(l.moves.length ? l.moves.map((m) => `- ${m}`) : ["Your ESPN lineup already matches it."]), l.url]),
    "",
    `Stop these emails: ${unsubscribeUrl}`,
    "",
  ].join("\n");
  return { subject, html, text };
}

/** ESPN signed War Room out, so the Sunday lineup couldn't be written. */
export function renderReconnectEmail({ url, unsubscribeUrl }: { url: string; unsubscribeUrl: string }): SeasonEmail {
  const subject = "Reconnect ESPN for your Sunday lineup";
  const body = "ESPN signed War Room out, which it does every so often, so this morning's AI lineup couldn't be written. Open your league on ESPN and click the War Room bookmark to reconnect.";
  const html = shell({
    title: subject,
    preheader: "One click on ESPN and you're back.",
    headline: "Reconnect ESPN.",
    body: `<tr><td style="padding:10px 32px 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">${escape(body)}</td></tr>
        <tr><td style="padding:20px 32px 0;">${button(url, "How to reconnect")}</td></tr>`,
    footer: footer(unsubscribeUrl),
  });
  return { subject, html, text: [subject, "", body, "", url, "", `Stop these emails: ${unsubscribeUrl}`, ""].join("\n") };
}

/**
 * The lineup changes that involve a player in the early game (11.4), going in or coming out, as
 * "Start A at FLEX over B". Moves among Sunday players can wait for Sunday; these can't.
 */
export function earlyMoves(view: SeasonView, teams: readonly string[]): string[] {
  const roster = view.teams.find((t) => t.id === view.myTeamId)?.roster ?? [];
  const byId = new Map(roster.map((p) => [p.playerId, p]));
  const early = (id: number | null) => {
    const p = id === null ? undefined : byId.get(id);
    return !!p && !p.locked && p.team !== null && teams.includes(p.team);
  };
  return compareLineups(roster, view.lineup)
    .filter((row) => row.changed && !row.locked && (early(row.now) || early(row.next)))
    .map((row) => {
      const now = row.now === null ? undefined : byId.get(row.now);
      const next = row.next === null ? undefined : byId.get(row.next);
      const slot = SLOT[row.key] ?? row.key;
      if (!next) return `Bench ${now!.name} (nobody can fill ${slot})`;
      return `Start ${next.name} at ${slot}${now ? ` over ${now.name}` : ""}`;
    });
}

/** "Set your lineup before Thursday's 8:15 PM kickoff": the moves involving that game, per league. */
export function renderEarlyEmail({ kickoff, leagues, unsubscribeUrl }: { kickoff: string; leagues: { name: string; url: string; moves: string[] }[]; unsubscribeUrl: string }): SeasonEmail {
  const subject = `Set your lineup before ${kickoff}`;
  const lead = "These changes involve players in that game. They lock at kickoff, so the Sunday lineup comes too late for them.";
  const sections = leagues
    .map(
      (l) => `<tr><td style="padding:22px 32px 0;">
          <div style="font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:${C.text};">${escape(l.name)}</div>
          <ul style="margin:8px 0 0;padding-left:18px;font-family:${FONT};font-size:14px;line-height:22px;color:${C.text};">${l.moves.map((m) => `<li>${escape(m)}</li>`).join("")}</ul>
          <div style="padding-top:12px;">${button(l.url, "See the lineup")}</div>
        </td></tr>`,
    )
    .join("\n");
  const html = shell({
    title: subject,
    preheader: leagues[0]?.moves[0] ?? lead,
    headline: `Before ${kickoff}.`,
    body: `<tr><td style="padding:10px 32px 0;font-family:${FONT};font-size:14px;line-height:22px;color:${C.muted};">${escape(lead)}</td></tr>\n${sections}`,
    footer: footer(unsubscribeUrl),
  });
  const text = [subject, "", lead, ...leagues.flatMap((l) => ["", l.name, ...l.moves.map((m) => `- ${m}`), l.url]), "", `Stop these emails: ${unsubscribeUrl}`, ""].join("\n");
  return { subject, html, text };
}

/** A kickoff as the email names it, in Eastern time: "Thursday's 8:15 PM ET kickoff". */
export function kickoffLabel(at: number): string {
  const day = new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long" });
  const time = new Date(at).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return `${day}'s ${time} ET kickoff`;
}
