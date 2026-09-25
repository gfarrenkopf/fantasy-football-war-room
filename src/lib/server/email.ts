import "server-only";
import { config } from "@/lib/config";

/** A message the app sends itself (not the sign-in link, which Auth.js sends). */
export interface OutgoingEmail {
  subject: string;
  html: string;
  text: string;
}

export type SendEmail = (to: string, email: OutgoingEmail, headers?: Record<string, string>) => Promise<void>;

/** Sends through Resend with the sign-in email's key and sender, or null when those aren't set. */
export function getEmailSender(): SendEmail | null {
  const { resendApiKey, emailFrom } = config;
  if (!resendApiKey || !emailFrom) return null;
  return async (to, { subject, html, text }, headers) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: emailFrom, to, subject, html, text, ...(headers ? { headers } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Resend error: ${res.status} ${await res.text()}`);
  };
}
