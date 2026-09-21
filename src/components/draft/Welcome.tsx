"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { announceSignedIn } from "@/lib/auth/channel";
import { getStores, type LeagueRecord } from "@/lib/storage";
import { useAccount } from "./Account";
import { cx, s } from "./cx";
import { useConfirm, useToast } from "./Feedback";
import { useLeague } from "./LeagueProvider";
import { Confetti } from "./OpeningNight";
import { useMediaQuery } from "./useMediaQuery";

type Kind = "new" | "back";

/** How long "Welcome back" stays when there's nothing to decide: read it, then get on with it. */
const BACK_LIFE = 3200;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Arriving signed in. Auth.js sends a first sign-in to `?welcome=new` (pages.newUser) and every
 * other one to `?welcome=1`; both parameters, and the `callbackUrl` Auth.js appends to the first,
 * are stripped the moment they're read, so a reload or a shared link never replays the moment.
 *
 * A new account gets the welcome card and a short fountain of confetti (DESIGN.md, "The Welcome
 * Exception"); a returning one gets a quieter card that leaves on its own. Either way, leagues
 * saved on this device before signing in are offered inside the card rather than in a separate
 * dialog. Without a welcome parameter (a later visit with leagues still waiting), the offer
 * arrives as a plain confirm. The landing tab also tells any tab still saying "check your inbox".
 * (A league just created on the landing page, `?new=1`, gets OpeningNight instead.)
 *
 * While it's arriving it holds back the first-run league setup (`useWelcomeHold`): a new account
 * has no leagues yet, and asking someone to set one up while the card offers to bring theirs in
 * would ask the same question twice. Adding the league makes setup unnecessary; keeping it on the
 * device lets setup follow once the card is gone.
 */
export function Welcome({ children }: { children: React.ReactNode }) {
  const user = useAccount();
  const { hydrated, reload } = useLeague();
  const confirm = useConfirm();
  const toast = useToast();
  const ran = useRef(false);
  const [card, setCard] = useState<{ kind: Kind; pending: LeagueRecord[] } | null>(null);
  // Read at first render, not in an effect: the setup dialog decides whether to open on its first
  // render too. The server renders the loading screen either way, so this can't mismatch.
  const [hold, setHold] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("welcome"));

  useEffect(() => {
    if (ran.current || !hydrated || !user) return;
    ran.current = true;

    const url = new URL(window.location.href);
    const param = url.searchParams.get("welcome");
    const kind: Kind | null = param === "new" ? "new" : param === "1" ? "back" : null;
    if (kind) {
      url.searchParams.delete("welcome");
      url.searchParams.delete("callbackUrl");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      announceSignedIn();
    }

    const imports = getStores().imports;
    void (async () => {
      const pending = (await imports?.pending()) ?? [];
      if (kind) return setCard({ kind, pending });
      setHold(false);
      if (!imports || !pending.length) return;
      const names = pending.map((l) => l.name).join(", ");
      const one = pending.length === 1;
      const ok = await confirm({
        message: `${one ? "A league" : `${pending.length} leagues`} saved on this device before you signed in (${names}) ${one ? "isn't" : "aren't"} in your account. Add ${one ? "it" : "them"} so ${one ? "it syncs" : "they sync"} across devices?`,
        confirmLabel: one ? "Add to account" : `Add ${pending.length} leagues`,
        cancelLabel: "Keep on this device only",
      });
      const ids = pending.map((l) => l.id);
      if (!ok) return imports.dismiss(ids);
      await imports.importLeagues(ids);
      await reload();
      toast(one ? `${pending[0].name} added to your account` : `${pending.length} leagues added to your account`);
    })();
  }, [user, hydrated, confirm, toast, reload]);

  const close = useCallback(() => {
    setCard(null);
    setHold(false);
  }, []);

  return (
    <WelcomeHold.Provider value={hold && !!user}>
      {children}
      {card && user && <WelcomeCard kind={card.kind} email={user.email} pending={card.pending} onClose={close} />}
    </WelcomeHold.Provider>
  );
}

const WelcomeHold = createContext(false);

/** True while a sign-in arrival is still settling; first-run setup waits for it. */
export const useWelcomeHold = () => useContext(WelcomeHold);

function WelcomeCard({ kind, email, pending, onClose }: { kind: Kind; email: string | null; pending: LeagueRecord[]; onClose(): void }) {
  const { leagues, reload } = useLeague();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  /** The offer to bring this device's leagues along: undecided, in flight, or answered. */
  const [offer, setOffer] = useState<"ask" | "adding" | "added" | "kept" | "failed" | null>(pending.length ? "ask" : null);
  const [leaving, setLeaving] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const deciding = offer === "ask" || offer === "adding" || offer === "failed";
  // "Welcome back" with nothing to decide is a status line that leaves; everything else waits.
  const fleeting = kind === "back" && !pending.length;

  const close = useCallback(() => {
    if (reduced) return onClose();
    setLeaving(true);
    setTimeout(onClose, 180);
  }, [onClose, reduced]);

  useEffect(() => {
    if (!fleeting) return;
    const t = setTimeout(close, BACK_LIFE);
    return () => clearTimeout(t);
  }, [fleeting, close]);

  // A card with a question takes focus, on its answer; a card that leaves by itself never does.
  useEffect(() => {
    if (!fleeting) primary.current?.focus({ preventScroll: true });
  }, [fleeting, offer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  const bring = async () => {
    const imports = getStores().imports;
    if (!imports) return;
    setOffer("adding");
    try {
      await imports.importLeagues(pending.map((l) => l.id));
      await reload();
      setOffer("added");
    } catch {
      setOffer("failed");
    }
  };
  const keep = async () => {
    await getStores().imports?.dismiss(pending.map((l) => l.id));
    setOffer("kept");
  };

  const names = pending.length === 1 ? pending[0].name : plural(pending.length, "league");
  const synced = leagues.length > 0 && offer !== "ask" && offer !== "adding";

  return (
    <>
      {kind === "new" && !reduced && <Confetti from="bottom" life={2000} density={0.55} className={s.welcomeConfetti} />}
      <div
        className={cx("pickCard", "welcome", leaving && "leaving", !fleeting && "holds")}
        style={{ "--life": `${BACK_LIFE}ms` } as React.CSSProperties}
        role={fleeting ? "status" : "dialog"}
        aria-live={fleeting ? "polite" : undefined}
        aria-labelledby="welcome-title"
        onClick={fleeting ? close : undefined}
        title={fleeting ? "Tap to dismiss" : undefined}
      >
        <div className={s.pcHead}>
          <span className={s.pcCheck} aria-hidden="true">
            ✓
          </span>
          <div className={s.pcWho}>
            <b id="welcome-title" className={s.pcName}>
              {kind === "new" ? "You're in." : "Welcome back."}
            </b>
            {email && <span className={s.pcMeta}>{email}</span>}
          </div>
          {!fleeting && (
            <button type="button" className={s.wcClose} onClick={close} aria-label="Close">
              ×
            </button>
          )}
        </div>

        {kind === "new" ? (
          <ul className={s.wcFacts}>
            {synced && <li>{plural(leagues.length, "league")} synced to your account</li>}
            <li>Every pick saves as you log it</li>
            <li>Sign in with this email on your phone and the same board is there</li>
          </ul>
        ) : (
          synced && <div className={s.pcNext}>{plural(leagues.length, "league")} synced. Pick up where you left off.</div>
        )}

        {offer && (
          <div className={s.wcAsk} aria-live="polite">
            {offer === "added" ? (
              <p>
                <b>{names}</b> {pending.length === 1 ? "is" : "are"} in your account now.
              </p>
            ) : offer === "kept" ? (
              <p>
                <b>{names}</b> {pending.length === 1 ? "stays" : "stay"} on this device only.
              </p>
            ) : (
              <>
                <p>
                  {pending.length === 1 ? (
                    <>
                      Bring <b>{names}</b> into your account?
                    </>
                  ) : (
                    <>
                      Bring the <b>{names}</b> on this device into your account?
                    </>
                  )}{" "}
                  {offer === "failed" ? <span className={s.wcBad}>That didn&apos;t go through. Try again.</span> : "Right now it only lives here."}
                </p>
                <div className={s.wcActions}>
                  <button ref={primary} type="button" className={cx("btn", "primary")} onClick={() => void bring()} disabled={offer === "adding"}>
                    {offer === "adding" ? "Adding…" : "Add to account"}
                  </button>
                  <button type="button" className={cx("btn")} onClick={() => void keep()} disabled={offer === "adding"}>
                    Keep on this device
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!fleeting && !deciding && (
          <div className={s.wcActions}>
            <button ref={primary} type="button" className={cx("btn", "primary")} onClick={close}>
              Let&apos;s draft →
            </button>
          </div>
        )}
        {fleeting && <i className={s.pcLife} aria-hidden="true" />}
      </div>
    </>
  );
}
