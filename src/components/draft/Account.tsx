"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/auth/types";
import { signOutAction } from "@/app/actions/auth";
import { getStores } from "@/lib/storage";
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
  const { cloudEnabled } = useFlags();
  const user = useAccount();
  const confirm = useConfirm();
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
      <button className={cx("btn")} onClick={() => void signOut()}>
        Sign out
      </button>
    </span>
  );
}
