import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy · Draft Room",
  description: "What Draft Room collects, why, who processes it, and how to delete it.",
};

/** The policy's effective date. Change it with any change to what the page says. */
const EFFECTIVE = "October 13, 2026";

/**
 * The privacy policy (APE-373). App Store Connect needs its URL, and Apple checks it against the
 * app's privacy labels, so keep it true to the code: what's stored is in src/lib/db/schema.ts,
 * what each outside service gets is in src/lib/config.ts. Static, and served by self-hosted copies
 * too, so anything that only applies to draftroom.online says so.
 */
export default function Privacy() {
  return (
    <main className="min-h-dvh bg-bg px-4 py-12 text-text sm:px-6">
      <article className="mx-auto max-w-[68ch] text-[14px] leading-[1.6] [&_a]:text-sky [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-[17px] [&_h2]:font-semibold [&_li]:mt-2 [&_p]:mt-3 [&_strong]:text-text [&_ul]:list-disc [&_ul]:pl-5">
        <Link href="/" className="text-[13px] !text-muted !no-underline hover:!text-text">
          ← Draft Room
        </Link>
        <h1 className="mt-6 text-[28px] leading-tight font-bold tracking-[-0.02em]">Privacy</h1>
        <p className="text-muted">Effective {EFFECTIVE}</p>

        <p>
          Draft Room helps you draft and run a fantasy football team. This page says what it keeps about you, why, who else handles it, and how to delete it.
          It&apos;s written for <strong>draftroom.online</strong> and the Draft Room iPhone app, run by <strong>Apeman Tech</strong>. Questions go to{" "}
          <a href="mailto:greg@apeman.tech">greg@apeman.tech</a>.
        </p>

        <h2>Without an account</h2>
        <p>
          The draft board, practice drafts and plans work without signing in. Everything you enter stays in your browser&apos;s storage on your device; none
          of it is sent to us.
        </p>

        <h2>What we keep when you have an account</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your email address, and your name if your sign-in provider (Google or Apple) shares it. If you use Apple&apos;s
            &ldquo;Hide my email&rdquo;, we only ever see the relay address.
          </li>
          <li>
            <strong>Your leagues and drafts:</strong> league settings, your board, your picks, and the plans and recaps Draft Room makes for them, so they&apos;re
            the same on every device.
          </li>
          <li>
            <strong>Your ESPN login, only if you connect ESPN:</strong> the two login cookies ESPN gives your browser (never your ESPN password). They&apos;re
            stored encrypted and used only to read your leagues and to make the changes you confirm. We delete them when you disconnect, or after the season
            ends (February 1 of the following year), whichever comes first. A draft room join code you hand over is deleted when the draft ends, or after 12
            hours.
          </li>
          <li>
            <strong>Your settings:</strong> the email alerts you&apos;ve chosen, and a record of which alerts we&apos;ve sent so you never get one twice.
          </li>
          <li>
            <strong>Device tokens (iPhone app):</strong> if you allow notifications, the token Apple gives us to send them to your phone.
          </li>
          <li>
            <strong>Purchases:</strong> what you bought, for which league, when, and for how much. Card details go straight to Stripe; we never see them.
          </li>
          <li>
            <strong>Server logs:</strong> our server records errors (the page or route and what went wrong) so we can fix them. Sign-in links, email addresses
            and request headers are left out of these records.
          </li>
        </ul>

        <h2>What we don&apos;t do</h2>
        <ul>
          <li>We don&apos;t sell or rent your data, or share it with anyone for their own use.</li>
          <li>There are no ads, and no analytics, tracking pixels or third-party trackers on the site or in the app.</li>
          <li>The site sets cookies only to keep you signed in and to make sign-in safe.</li>
        </ul>

        <h2>Who else handles it</h2>
        <p>These services process data for us, only to run Draft Room:</p>
        <ul>
          <li>
            <strong>DigitalOcean</strong> hosts the server and database.
          </li>
          <li>
            <strong>Resend</strong> delivers our emails (sign-in links and the alerts you&apos;ve chosen), so it gets your email address.
          </li>
          <li>
            <strong>Stripe</strong> takes payments. You give your card details to Stripe, not to us.
          </li>
          <li>
            <strong>Anthropic</strong> writes the AI features (game plans, lineups, trade write-ups). It gets your league&apos;s settings, rosters and players,
            never your name, email or ESPN login, and it doesn&apos;t train on them.
          </li>
          <li>
            <strong>Google</strong> and <strong>Apple</strong> handle sign-in if you choose them, under their own privacy policies.
          </li>
          <li>
            <strong>ESPN:</strong> when you connect ESPN, Draft Room talks to ESPN with your login to read your league and make the changes you confirm. Draft
            Room isn&apos;t affiliated with ESPN.
          </li>
        </ul>

        <h2>Deleting your account</h2>
        <p>
          Delete your account any time from the account menu on the website, or from Settings in the iPhone app. It takes effect at once and removes your
          account, your sign-ins, your leagues and drafts and everything made for them, your ESPN login, your settings and your device tokens.
        </p>
        <p>
          We keep two things without anything that links them to you: the record of each purchase (the amount, date and Stripe reference, which tax law and
          refunds need), and counts of the AI work we paid for. Stripe keeps its own payment records under{" "}
          <a href="https://stripe.com/privacy" rel="noopener noreferrer">
            its privacy policy
          </a>
          . Copies in our database backups are gone within 14 days, when those backups are deleted.
        </p>
        <p>
          You can also email <a href="mailto:greg@apeman.tech">greg@apeman.tech</a> to ask what we hold about you, to correct it, or to delete it.
        </p>

        <h2>Children</h2>
        <p>Draft Room isn&apos;t meant for children under 13, and we don&apos;t knowingly keep data about them. If you think a child has an account, email us and we&apos;ll delete it.</p>

        <h2>Changes</h2>
        <p>If this policy changes, we&apos;ll update this page and its effective date. If the change matters to how your data is used, we&apos;ll email you first.</p>
      </article>
    </main>
  );
}
