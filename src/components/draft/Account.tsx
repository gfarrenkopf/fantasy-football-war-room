"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/auth/types";
import { signOutAction } from "@/app/actions/auth";
import { formatMoney } from "@/lib/money";
import { getStores, type Purchase } from "@/lib/storage";
import { cx, s } from "./cx";
import { useConfirm } from "./Feedback";
import { useFlags } from "./Flags";

const AccountContext = createContext<SessionUser | null>(null);

/** The signed-in user (from the server session), or null. */
export function AccountProvider({ user, children }: { user: SessionUser | null; children: React.ReactNode }) {
  return <AccountContext.Provider value={user}>{children}</AccountContext.Provider>;
}

export const useAccount = () => useContext(AccountContext);

/** Sign-in link, or the signed-in email with sign-out. Renders nothing when cloud features are off. */
export function AccountMenu() {
  const { cloudEnabled, paymentsEnabled } = useFlags();
  const user = useAccount();
  const confirm = useConfirm();
  const [showPurchases, setShowPurchases] = useState(false);
  if (!cloudEnabled) return null;

  if (!user) {
    return (
      // A full page load on purpose: the Auth.js sign-in page is a server route, not an app page.
      // eslint-disable-next-line @next/next/no-html-link-for-pages
      <a className={s.btn} href="/api/auth/signin?callbackUrl=%2F" title="Sign in to sync your leagues across devices">
        Sign in
      </a>
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
    await signOutAction();
    // A full reload, not router.push(): stores and providers must all start over for the signed-out user.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
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
