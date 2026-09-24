"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dataset, LEAGUE_PRESETS } from "@/lib/data";
import { MAX_TEAMS, MIN_TEAMS, validateLeague } from "@/lib/draft/league";
import type { LeagueSettings, ScoringFormat } from "@/lib/draft/types";
import type { PublicFlags } from "@/lib/config";
import { getStores, newLeagueRecord, type Farewell } from "@/lib/storage";
import { cx, s } from "./cx";
import { FarewellFace } from "./Farewell";
import { SignIn } from "./SignIn";

const SCORING_LABELS: { value: ScoringFormat; label: string }[] = [
  { value: "ppr", label: "Full PPR" },
  { value: "half", label: "Half PPR" },
  { value: "std", label: "Standard" },
];

/**
 * Only the formats the loaded player data actually has rankings for. With the bundled PPR-only
 * sample there is nothing to choose, so the picker doesn't appear at all; self-hosters with
 * richer data get it back automatically.
 */
const SCORING = SCORING_LABELS.filter((o) => dataset.scoring.includes(o.value));

const TEAM_CHOICES = [8, 10, 12, 14, 16].filter((n) => n >= MIN_TEAMS && n <= MAX_TEAMS);

/**
 * One panel, two faces. The default face is the whole anonymous path: one line of promise, two
 * questions, one button. Returning managers flip it to sign in from the link in its corner, and
 * flip back just as easily — the panel never holds both at once, which is what kept it simple.
 *
 * Nothing here is a preview: the controls edit the league the board behind is actually drafting,
 * and "Open the war room" saves exactly that league and walks into it.
 */
type Face = "draft" | "signin" | "farewell";

export function EntryPanel({
  flags,
  league,
  onLeague,
  openOn = "draft",
  farewell,
}: {
  flags: PublicFlags;
  league: LeagueSettings;
  onLeague(next: LeagueSettings): void;
  /** The face on the first paint: "farewell" straight after a sign-out (the server knows). */
  openOn?: Face;
  /**
   * The goodbye's contents: undefined while the sign-out's hand-off is being read, null when there
   * was none (a fresh tab), which still says goodbye, just without the leagues.
   */
  farewell?: Farewell | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [face, setFace] = useState<Face>(openOn);
  const errors = validateLeague(league, dataset);
  const canSignIn = flags.cloudEnabled && (flags.emailAuthEnabled || flags.googleAuthEnabled);

  /*
   * The re-deal, said out loud. Changing the league re-deals the board behind this panel, which a
   * screen reader can't see (the board is aria-hidden). The region is mounted empty from the first
   * render so its later content is announced, and is visually hidden: the board says it to the eye.
   */
  const [reseat, setReseat] = useState("");
  const shape = `${league.teams}-${league.mySlot}-${league.scoring}`;
  // Compared against the shape itself, not a mount flag: React runs effects twice in development,
  // which would announce a re-deal that never happened.
  const announced = useRef(shape);
  useEffect(() => {
    if (announced.current === shape) return;
    announced.current = shape;
    setReseat(`Mock draft re-dealt for ${league.teams} teams, picking ${league.mySlot}`);
  }, [shape, league.teams, league.mySlot]);

  // Moving between faces moves the reader too, so keyboard and screen-reader users land in the new face.
  const heading = useRef<HTMLHeadingElement>(null);
  const flipped = useRef(false);
  useEffect(() => {
    if (flipped.current) heading.current?.focus();
  }, [face]);
  // The goodbye is the page's whole message when it arrives, so the reader starts on it.
  const ready = farewell !== undefined;
  useEffect(() => {
    if (ready && face === "farewell") heading.current?.focus({ preventScroll: true });
    // Only when the goodbye's contents land, not on every flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  /*
   * The panel holds the height of the face it's leaving, so a shorter face doesn't pull the panel
   * up out from beside the landing clock mid-flip. It can still grow (the sent state is taller).
   * The goodbye is the exception: it lists every league, so holding its height would leave the
   * next face stretched to fit leagues it doesn't show, for as long as the page is open.
   */
  const panel = useRef<HTMLDivElement>(null);
  const [holdHeight, setHoldHeight] = useState<number | undefined>();
  const flip = (to: Face) => {
    flipped.current = true;
    setHoldHeight(face === "farewell" ? undefined : panel.current?.offsetHeight);
    setFace(to);
  };

  const open = async () => {
    if (busy || errors.length) return;
    setBusy(true);
    const record = newLeagueRecord("My league", league);
    const stores = getStores();
    await stores.league.saveLeague(record);
    const prefs = await stores.prefs.getPrefs();
    if (prefs) await stores.prefs.savePrefs({ ...prefs, activeLeagueId: record.id });
    router.push("/draft?new=1");
  };

  return (
    <div ref={panel} className={s.panel} style={holdHeight ? { minHeight: holdHeight } : undefined}>
      <div className={s.sweep} aria-hidden="true" />
      <div className={s.brand}>
        <b>Fantasy War Room</b>
        {canSignIn &&
          (face === "signin" ? (
            <button type="button" className={s.faceLink} onClick={() => flip("draft")}>
              ← New draft
            </button>
          ) : (
            <button type="button" className={s.faceLink} onClick={() => flip("signin")}>
              Sign in
            </button>
          ))}
      </div>

      {face === "farewell" ? (
        <FarewellFace
          key="farewell"
          ref={heading}
          farewell={farewell}
          onSignIn={() => flip(canSignIn ? "signin" : "draft")}
          onNewDraft={() => flip("draft")}
        />
      ) : face === "draft" ? (
        <div key="draft" className={s.face}>
          <h1 className={s.thesis} ref={heading} tabIndex={-1}>
            Your draft is in a week.
            <br />
            <em>Or in twenty minutes.</em>
          </h1>
          <p className={s.sub}>Either way it takes one screen to set up, nothing to install, and no account to start.</p>

          <div className={s.setup}>
            <div className={s.setupHead}>Your draft</div>
            <div className={s.fields}>
              <label className={s.field}>
                <span>Teams</span>
                <select
                  className={s.select}
                  value={league.teams}
                  onChange={(e) => {
                    const teams = Number(e.target.value);
                    onLeague({ ...league, teams, mySlot: Math.min(league.mySlot, teams) });
                  }}
                >
                  {TEAM_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                <span>You pick</span>
                <select className={s.select} value={league.mySlot} onChange={(e) => onLeague({ ...league, mySlot: Number(e.target.value) })}>
                  {Array.from({ length: league.teams }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              {SCORING.length > 1 && (
                <label className={cx("field", "wideField")}>
                  <span>Scoring</span>
                  <select className={s.select} value={league.scoring} onChange={(e) => onLeague({ ...league, scoring: e.target.value as ScoringFormat })}>
                    {SCORING.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className={s.srOnly} role="status" aria-live="polite">
              {reseat}
            </p>
            <button type="button" className={cx("btn", "primary", "wide")} onClick={() => void open()} disabled={busy || errors.length > 0}>
              {busy ? "Opening…" : "Open the war room →"}
            </button>
            {errors.length > 0 && (
              <p className={s.error} role="alert">
                {errors[0]}
              </p>
            )}
            <p className={s.fine}>
              {flags.cloudEnabled ? "No account needed. Sign in later and your draft comes with you." : "No account, no network. Everything stays on this device."}
            </p>
          </div>
        </div>
      ) : (
        <div key="signin" className={s.face}>
          <h1 id="signin-face-title" className={s.thesis} ref={heading} tabIndex={-1}>
            Your leagues are waiting.
          </h1>
          <p id="signin-face-sub" className={s.sub}>
            Sign in and they&apos;re on this device too, picks and all.
          </p>
          <div className={s.setup}>
            <div className={s.setupHead}>Sign in</div>
            <SignIn
              flags={flags}
              title={null}
              primary
              initialEmail={farewell?.email ?? ""}
              describedBy="signin-face-title signin-face-sub"
              fine="No password. We email you a link that signs you in."
            />
          </div>
          {/* What an account does, in the room's own mark: a pick-track square in mine green. */}
          <ul className={s.perks}>
            <li>Every league, on your phone and your laptop</li>
            <li>Picks save as you log them</li>
            <li>Your seat is kept mid-draft</li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** The league the page opens on: the standard 12-team PPR draft, from the middle of the room. */
export const startingLeague = (): LeagueSettings => ({ ...LEAGUE_PRESETS[1].league, mySlot: 6 });
