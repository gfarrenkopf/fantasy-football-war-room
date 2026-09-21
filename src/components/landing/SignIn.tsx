"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { signInWithEmail, signInWithGoogle } from "@/app/actions/auth";
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
export function SignIn({ flags, title = "Already have leagues here?" }: { flags: PublicFlags; title?: string | null }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, start] = useTransition();
  const sentHeading = useRef<HTMLParagraphElement>(null);

  // Moves the reader to the confirmation rather than relying on a live region that did not
  // exist a moment ago — a region mounted with its content is announced unreliably.
  useEffect(() => {
    if (state.kind === "sent") sentHeading.current?.focus();
  }, [state.kind]);

  if (state.kind === "sent") {
    return (
      <div className={s.sent}>
        <p className={s.sentHead} ref={sentHeading} tabIndex={-1}>
          Check your email.
        </p>
        <p>
          A sign-in link is on its way to <span className={s.sentAddr}>{state.email}</span>. Open it on any device and your leagues come with you.
        </p>
        <button type="button" className={s.linkBtn} onClick={() => setState({ kind: "idle" })}>
          Use a different address
        </button>
      </div>
    );
  }

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
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state.kind === "error") setState({ kind: "idle" });
            }}
            required
          />
          <button type="submit" className={cx("btn")} disabled={pending}>
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
      <p className={s.fine}>Signing in syncs your leagues across devices. It never changes how the draft room works.</p>
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
