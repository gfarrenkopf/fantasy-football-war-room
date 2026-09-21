"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { signInWithEmail, signInWithGoogle } from "@/app/actions/auth";
import { listenForSignIn } from "@/lib/auth/channel";
import { mailboxFor } from "@/lib/auth/mailbox";
import type { PublicFlags } from "@/lib/config";
import { cx, s } from "./cx";

type State = { kind: "idle" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

const MESSAGES = {
  "invalid-email": "That doesn't look like an email address.",
  unavailable: "Email sign-in isn't set up on this server.",
  failed: "Couldn't send the link. Try again in a moment.",
} as const;

/**
 * Sign-in, in the page's own language: the magic link is sent by a server action and the form
 * swaps to its own confirmation, so nobody is handed to Auth.js's generic page mid-decision.
 * Each method renders only when its credentials exist (see publicFlags). Used by the landing
 * page and by the war room's account menu, so there is exactly one sign-in surface.
 */
export function SignIn({
  flags,
  title = "Already have leagues here?",
  focused = false,
}: {
  flags: PublicFlags;
  title?: string | null;
  /**
   * Signing in is the host's whole purpose (the war room's dialog, which someone opened to type
   * into): the field takes focus, sending is the primary action, and the host says the fine print.
   */
  focused?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, start] = useTransition();
  const sentHeading = useRef<HTMLParagraphElement>(null);

  // Moves the reader to the confirmation rather than relying on a live region that did not
  // exist a moment ago — a region mounted with its content is announced unreliably.
  useEffect(() => {
    if (state.kind === "sent") sentHeading.current?.focus();
  }, [state.kind]);

  if (state.kind === "sent") return <Sent email={state.email} headingRef={sentHeading} onChangeAddress={() => setState({ kind: "idle" })} />;

  return (
    // Structural only — the children below own their own spacing in both hosts.
    <div>
      {title && <h2 className={s.signInTitle}>{title}</h2>}
      {flags.emailAuthEnabled && (
        <form
          className={s.emailRow}
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const result = await signInWithEmail(email);
              setState(result.ok ? { kind: "sent", email: email.trim().toLowerCase() } : { kind: "error", message: MESSAGES[result.reason] });
            });
          }}
        >
          <label className={s.srOnly} htmlFor="landing-email">
            Email address
          </label>
          <input
            id="landing-email"
            className={s.input}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            autoFocus={focused}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state.kind === "error") setState({ kind: "idle" });
            }}
            required
          />
          <button type="submit" className={cx("btn", focused && "primary")} disabled={pending}>
            {pending ? "Sending…" : "Send me a link"}
          </button>
        </form>
      )}
      {state.kind === "error" && (
        <p className={s.error} role="alert">
          {state.message}
        </p>
      )}
      {flags.emailAuthEnabled && flags.googleAuthEnabled && <div className={s.or}>or</div>}
      {flags.googleAuthEnabled && (
        <form action={signInWithGoogle}>
          <button type="submit" className={cx("btn", "wide")}>
            <GoogleMark />
            Continue with Google
          </button>
        </form>
      )}
      {!focused && <p className={s.fine}>Signing in syncs your leagues across devices. It never changes how the draft room works.</p>}
    </div>
  );
}

/** Seconds before another link can be sent: long enough for the first to arrive. */
const RESEND_AFTER = 30;

/**
 * "Check your inbox", made useful: the link is seen leaving, the reader's own webmail is one tap
 * away when we know it, a second link is there if the first went astray, and if the link gets
 * opened in another tab, this one finds out and says so instead of waiting forever.
 */
function Sent({
  email,
  headingRef,
  onChangeAddress,
}: {
  email: string;
  headingRef: React.RefObject<HTMLParagraphElement | null>;
  onChangeAddress(): void;
}) {
  const mailbox = mailboxFor(email);
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [resend, setResend] = useState<{ kind: "idle" } | { kind: "sent" } | { kind: "error"; message: string }>({ kind: "idle" });
  const [pending, start] = useTransition();
  const [elsewhere, setElsewhere] = useState(false);
  const continueBtn = useRef<HTMLButtonElement>(null);

  const wait = Math.max(0, RESEND_AFTER - Math.floor((now - sentAt) / 1000));
  useEffect(() => {
    if (wait === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [wait]);

  useEffect(() => listenForSignIn(() => setElsewhere(true)), []);
  useEffect(() => {
    if (elsewhere) continueBtn.current?.focus();
  }, [elsewhere]);

  if (elsewhere) {
    return (
      <div className={cx("sent", "arrived")}>
        <div className={s.arrivedHead}>
          <span className={s.arrivedCheck} aria-hidden="true">
            ✓
          </span>
          <p className={s.sentHead}>You&apos;re in.</p>
        </div>
        <p>
          <span className={s.sentAddr}>{email}</span> signed in on another tab. Your leagues are synced.
        </p>
        {/* A full load, not router.push(): the stores and providers have to start over signed in. */}
        {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination */}
        <button ref={continueBtn} type="button" className={cx("btn", "primary", "wide")} onClick={() => window.location.assign("/draft")}>
          Continue here →
        </button>
      </div>
    );
  }

  const again = () =>
    start(async () => {
      const result = await signInWithEmail(email);
      if (result.ok) {
        setSentAt(Date.now());
        setNow(Date.now());
        setResend({ kind: "sent" });
      } else setResend({ kind: "error", message: MESSAGES[result.reason] });
    });

  return (
    <div className={s.sent}>
      <Flight />
      <p className={s.sentHead} ref={headingRef} tabIndex={-1}>
        Check your inbox.
      </p>
      <p>
        A sign-in link is on its way to <span className={s.sentAddr}>{email}</span>. Open it on any device and your leagues come with you.
      </p>
      {mailbox && (
        <a className={cx("btn", "primary", "wide")} href={mailbox.url} target="_blank" rel="noopener noreferrer">
          Open {mailbox.name} →
        </a>
      )}
      <p className={s.sentHelp}>Not there after a minute? Check spam or junk for a subject with &ldquo;war room&rdquo; in it.</p>
      <div className={s.sentActions}>
        <button type="button" className={s.linkBtn} onClick={again} disabled={pending || wait > 0}>
          {pending ? "Sending…" : wait > 0 ? `Send another link in ${wait}s` : "Send another link"}
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" className={s.linkBtn} onClick={onChangeAddress}>
          Use a different address
        </button>
      </div>
      <p className={cx("sentNote", resend.kind === "error" && "bad")} role="status">
        {resend.kind === "sent" ? "Sent another. The newest link is the one to use." : resend.kind === "error" ? resend.message : ""}
      </p>
    </div>
  );
}

/**
 * The link leaving: an envelope rides a dashed arc from you to your inbox and lands with a green
 * check. CSS offset-path does the riding; reduced motion shows it already landed.
 */
function Flight() {
  return (
    <div className={s.flight} aria-hidden="true">
      <svg className={s.flightArc} viewBox="0 0 240 44" preserveAspectRatio="none">
        <path d="M8 38 Q 120 -10 226 26" />
      </svg>
      <span className={s.flightFrom} />
      <span className={s.envelope}>
        <svg viewBox="0 0 24 18">
          <rect x="1" y="1" width="22" height="16" rx="2.5" />
          <path d="M2 2.5 12 10l10-7.5" />
        </svg>
        <i className={s.envelopeCheck}>✓</i>
      </span>
    </div>
  );
}

/** Google's mark, inline: the app ships no icon library and no public/ directory. */
function GoogleMark() {
  return (
    <svg className={s.gmark} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285f4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-16z" />
      <path fill="#34a853" d="M24 46c5.9 0 10.9-1.9 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.4.1-6.7 5.2-.1.3C8 40.9 15.4 46 24 46z" />
      <path fill="#fbbc05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-.1-.3-6.8-5.3-.2.1A22 22 0 0 0 2 24c0 3.5.9 6.9 2.4 9.9l7.1-5.4z" />
      <path fill="#eb4335" d="M24 9.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.4 29.9 1 24 1 15.4 1 8 6.1 4.4 14.1l7.1 5.4C13.3 13.3 18.2 9.5 24 9.5z" />
    </svg>
  );
}
