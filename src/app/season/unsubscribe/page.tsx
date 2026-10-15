import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppBar } from "@/components/shell/AppBar";
import s from "@/components/season/season.module.css";
import { config } from "@/lib/config";
import { ALERT_LABELS, isAlertKind } from "@/lib/season/alerts";

export const metadata: Metadata = { title: "Email settings · Draft Room" };

/**
 * Where an email's "Stop these emails" link lands (11.3). A button, not the link itself, turns the
 * emails off: mail scanners open links, and opening one mustn't unsubscribe anybody.
 */
export default async function Unsubscribe({ searchParams }: PageProps<"/season/unsubscribe">) {
  await connection();
  if (!config.cloudEnabled) notFound();
  const { u, t, k, done } = await searchParams;
  // Links name the alert they came with (21.3); older ones turn every season email off.
  const kind = isAlertKind(k) ? k : null;
  const action = typeof u === "string" && typeof t === "string" ? `/api/season/unsubscribe?${new URLSearchParams({ u, t, ...(kind ? { k: kind } : {}), from: "page" })}` : null;
  const what = kind ? `the \u201c${ALERT_LABELS[kind].title}\u201d emails` : "Draft Room\u2019s season emails";
  return (
    <main className={s.root}>
      <AppBar />
      <div className={s.frame}>
        <header className={s.top}>
          <div className={s.titleBlock}>
            <h1 className={s.title}>Email settings</h1>
          </div>
        </header>
        <section className={`${s.panel} ${s.paywall}`}>
          {done === "1" ? (
            <p role="status">Done. You won&apos;t get {what} any more. Change it any time in Alerts, in the account menu or the iPhone app&apos;s settings.</p>
          ) : action ? (
            <form method="post" action={action} className={s.paywall}>
              <p>Stop {what}? Draft Room keeps doing the work; it just waits on the season page.</p>
              <button type="submit" className={s.primary}>
                Stop these emails
              </button>
            </form>
          ) : (
            <p>This link is incomplete. Use the one at the bottom of the email, or change it in Alerts, in the account menu.</p>
          )}
        </section>
      </div>
    </main>
  );
}
