import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import s from "@/components/season/season.module.css";
import { config } from "@/lib/config";

export const metadata: Metadata = { title: "Email settings · Fantasy War Room" };

/**
 * Where an email's "Stop these emails" link lands (11.3). A button, not the link itself, turns the
 * emails off: mail scanners open links, and opening one mustn't unsubscribe anybody.
 */
export default async function Unsubscribe({ searchParams }: PageProps<"/season/unsubscribe">) {
  await connection();
  if (!config.cloudEnabled) notFound();
  const { u, t, done } = await searchParams;
  const action = typeof u === "string" && typeof t === "string" ? `/api/season/unsubscribe?${new URLSearchParams({ u, t, from: "page" })}` : null;
  return (
    <main className={s.root}>
      <div className={s.frame}>
        <header className={s.top}>
          <div className={s.titleBlock}>
            <a href="/draft" className={s.brand}>
              Fantasy War Room
            </a>
            <h1 className={s.title}>Email settings</h1>
          </div>
        </header>
        <section className={`${s.panel} ${s.paywall}`}>
          {done === "1" ? (
            <p role="status">Done. You won&apos;t get Sunday lineup emails any more. Turn them back on from any league&apos;s season page.</p>
          ) : action ? (
            <form method="post" action={action} className={s.paywall}>
              <p>Stop the &ldquo;Your Sunday lineup is ready&rdquo; emails? Your AI lineups are still written; they just wait on the season page.</p>
              <button type="submit" className={s.primary}>
                Stop these emails
              </button>
            </form>
          ) : (
            <p>This link is incomplete. Use the one at the bottom of the email, or change it on any league&apos;s season page.</p>
          )}
        </section>
      </div>
    </main>
  );
}
