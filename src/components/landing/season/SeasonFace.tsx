"use client";

import { forwardRef } from "react";
import { s as door } from "../cx";
import { s } from "./cx";
import { ConnectEspn } from "./ConnectEspn";

/**
 * The entry panel's face in season (APE-340): the promise, then the one thing to do about it.
 * Connecting ESPN starts with signing in, which the connect page handles, so the panel has one
 * action rather than a form. Draft Room is the analyst; the visitor is the one who wins.
 */
export const SeasonFace = forwardRef<HTMLHeadingElement>(function SeasonFace(_, heading) {
  return (
    <div className={door.face}>
      <h1 className={door.thesis} ref={heading} tabIndex={-1}>
        You play to win the game.
        <br />
        <span className={s.thesisWin}>We make sure you start the team that does.</span>
      </h1>
      <p className={door.sub}>Draft Room sets your best ESPN lineup every week, finds the waiver pickups and trades that help, and tells you why.</p>
      <ConnectEspn className={s.faceCta} />
      <p className={s.late}>
        Drafting late? <a href="/draft">Open the Draft Room</a>
      </p>
    </div>
  );
});
