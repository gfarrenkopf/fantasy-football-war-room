"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth/types";
import { signOutAction } from "@/app/actions/auth";
import { formatMoney } from "@/lib/money";
import { gatherFarewell, getStores, saveFarewell, type Purchase } from "@/lib/storage";
import { SignIn } from "@/components/landing/SignIn";
import { cx, s } from "./cx";
import { useConfirm } from "./Feedback";
import { useFlags } from "./Flags";
import { leagueSummary } from "./Header";
import { useLeague } from "./LeagueProvider";

const AccountContext = createContext<SessionUser | null>(null);

/**
 * What Auth.js's error codes mean to the person holding the link. Failures land on `/draft?error=`
 * (pages.error) instead of Auth.js's own page; the dialog reopens with one of these.
 */
const SIGN_IN_ERRORS: Record<string, string> = {
  Verification: "That link has already been used or has expired. Links work once, for 24 hours. Send yourself a fresh one.",
  OAuthAccountNotLinked: "That address already signs in with an email link. Send yourself one below.",
  AccessDenied: "That sign-in was cancelled. Try again whenever you're ready.",
};
const SIGN_IN_FAILED = "Sign-in didn't go through. Try again.";

/** The signed-in user (from the server session), or null. */
export function AccountProvider({ user, children }: { user: SessionUser | null; children: React.ReactNode }) {
  return <AccountContext.Provider value={user}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);

/** Sign-in link, or the signed-in email with sign-out. Renders nothing when cloud features are off. */
export function AccountMenu() {
  const flags = useFlags();
  const { cloudEnabled, paymentsEnabled } = flags;
  const user = useAccount();
  const confirm = useConfirm();
  const [showPurchases, setShowPurchases] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [signInNotice, setSignInNotice] = useState<string | undefined>();
  const signInBtn = useRef<HTMLButtonElement>(null);

  // A sign-in link that failed (used, expired, cancelled) lands here with `?error=`: reopen the
  // dialog saying what happened. Signed in already, there's nothing to recover, so just tidy up.
  useEffect(() => {
    if (!cloudEnabled) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("error");
    if (code === null) return;
    // Stripped and acted on together, from a timeout: the dialog opens after the war room's first
    // paint, and an effect that's cleaned up before it fires (StrictMode) leaves the URL to retry.
    const t = setTimeout(() => {
      url.searchParams.delete("error");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      if (user) return;
      setSignInNotice(SIGN_IN_ERRORS[code] ?? SIGN_IN_FAILED);
      setShowSignIn(true);
    }, 0);
    return () => clearTimeout(t);
  }, [cloudEnabled, user]);

  const closeSignIn = useCallback(() => {
    setShowSignIn(false);
    setSignInNotice(undefined);
    // Back to where the reader was, not the top of the page.
    requestAnimationFrame(() => signInBtn.current?.focus());
  }, []);
  if (!cloudEnabled) return null;

  if (!user) {
    // The same sign-in the landing page shows, in a dialog. Anyone who started an anonymous
    // draft is redirected away from `/` from then on, so this is their only route to an account.
    if (!flags.emailAuthEnabled && !flags.googleAuthEnabled) return null;
    return (
      <>
        <button ref={signInBtn} className={s.btn} onClick={() => setShowSignIn(true)} title="Sign in to sync your leagues across devices">
          Sign in
        </button>
        {showSignIn && <SignInDialog onClose={closeSignIn} notice={signInNotice} />}
      </>
    );
  }

  const signOut = async () => {
    // Push any picks still waiting to sync; signing out clears this device's copy of the account.
    const synced = (await getStores().sync?.flush()) ?? true;
    if (!synced) {
      const ok = await confirm({
        message: "Some recent changes haven't synced to your account yet and will be lost if you sign out now. Sign out anyway?",
        confirmLabel: "Sign out",
        danger: true,
      });
      if (!ok) return;
    }
    // The room fades out now (see globals.css): clearing the session below re-renders it as an
    // empty signed-out room, which must never be seen on the way to the goodbye.
    const root = document.documentElement;
    root.dataset.leaving = "";
    // The goodbye on the landing page is built from what's here now; signing out clears it.
    saveFarewell(await gatherFarewell(getStores(), user.email).catch(() => ({ email: user.email, leagues: [] })));
    try {
      await signOutAction();
    } catch (error) {
      delete root.dataset.leaving;
      throw error;
    }
    // A full reload, not router.push(): stores and providers must all start over for the signed-out
    // user. To the door, not the room: a signed-out room with no leagues would open on league setup.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/?farewell=1");
  };

  return (
    <span className={s.account}>
      <span className={s.accountEmail} title={user.email ?? undefined}>
        {user.email ?? "Signed in"}
      </span>
      {paymentsEnabled && (
        <button className={cx("btn")} onClick={() => setShowPurchases(true)}>
          Purchases
        </button>
      )}
      <button className={cx("btn")} onClick={() => void signOut()}>
        Sign out
      </button>
      {showPurchases && <PurchasesDialog onClose={() => setShowPurchases(false)} />}
    </span>
  );
}

/** What the user has paid for and when. */
function PurchasesDialog({ onClose }: { onClose(): void }) {
  /** undefined while loading, null when it couldn't load. */
  const [purchases, setPurchases] = useState<Purchase[] | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void getStores()
      .checkout?.purchases()
      .then((list) => live && setPurchases(list));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      <div className={s.scrim} onClick={onClose} />
      <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="purchases-title">
        <h3 id="purchases-title">Purchases</h3>
        {purchases === undefined && <p className={s.lbl}>Loading…</p>}
        {purchases === null && <p>Couldn&apos;t load your purchases. Try again in a moment.</p>}
        {purchases?.length === 0 && <p>No purchases yet. A season pass unlocks the AI game plan for one league.</p>}
        {!!purchases?.length && (
          <ul className={s.purchases}>
            {purchases.map((p) => (
              <li key={`${p.leagueId}:${p.kind}`}>
                <div>
                  <b>Season pass</b>: {p.leagueName} ({p.season}){p.leagueDeleted && <span className={s.lbl}> · league deleted</span>}
                </div>
                <div className={s.lbl}>
                  {new Date(p.purchasedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                  {p.amountTotal !== null && p.currency && ` · ${formatMoney(p.amountTotal, p.currency)}`}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className={s.dialogActions}>
          <button className={cx("btn", "primary")} onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The landing page's sign-in, in the war room's dialog shell, framed as what it is: taking the
 * board you've built everywhere you go. The leagues on this device are listed by name, because
 * seeing your own work about to be kept is the reason to sign in. `notice` explains why the dialog
 * opened on its own (an expired link, say).
 */
export function SignInDialog({ onClose, notice }: { onClose(): void; notice?: string }) {
  const flags = useFlags();
  const { leagues } = useLeague();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      <div className={s.scrim} onClick={onClose} />
      <div className={cx("dialog", "signIn")} role="dialog" aria-modal="true" aria-labelledby="signin-title" aria-describedby="signin-lead">
        <h3 id="signin-title" className={s.siTitle}>
          Take your war room everywhere
        </h3>
        <p id="signin-lead" className={s.siLead}>
          Sign in and your leagues sync to your account: the same board on your laptop, your phone, and at the draft table. Nothing about how the room works changes.
        </p>
        {notice && (
          <p className={s.siNotice} role="alert">
            {notice}
          </p>
        )}
        {leagues.length > 0 && (
          <section className={s.siComing} aria-labelledby="signin-coming">
            <h4 id="signin-coming">Coming with you</h4>
            <ul>
              {leagues.map((l) => (
                <li key={l.id}>
                  <SyncMark />
                  <span className={s.siLeague}>
                    <b>{l.name}</b>
                    <span>{leagueSummary(l.settings)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <SignIn flags={flags} title={null} primary autoFocus fine={null} />
        <div className={s.dialogActions}>
          <button className={cx("btn")} onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </>
  );
}

/** Two arrows chasing each other: this league goes where you go. */
function SyncMark() {
  return (
    <svg className={s.siSync} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.5 6.5A5.5 5.5 0 0 0 3.2 4.8M2.5 9.5a5.5 5.5 0 0 0 10.3 1.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 1.8v3.3h3.3M13 14.2v-3.3H9.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
